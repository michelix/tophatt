// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Manuelle Aufstellung: bewerten, vervollständigen (Kapitän, Standards, Bank) und mit dem automatischen
// Vorschlag vergleichen, damit klar wird, was eine Änderung bewirkt.

import { type BenchSlot, type FieldPosition, type Lineup, type MatchSettings, type Player, Role } from "./model";
import { type LineupSector, RATING_SECTORS, type RatingSector, type SectorRatings, type TeamState, lineupSector, ratingLabel } from "./rating";
import { Evaluator, formationLabel, hatStatsOf, isAvailable, pickBench, pickCaptain, pickSetPieces } from "./optimizer";
import { GROUPS, GROUP_DE, groupValue } from "./squad";
import { SECTOR_DE } from "./weakness";

/** Formation aus den besetzten Positionen, z. B. "442" (Abwehr, Mittelfeld, Sturm) */
export function formationCode(positions: FieldPosition[]): string {
  let d = 0,
    m = 0,
    f = 0;
  for (const p of positions) {
    const s = lineupSector(p.role);
    if (s === "back" || s === "centralDefence") d++;
    else if (s === "wing" || s === "innerMidfield") m++;
    else if (s === "forward") f++;
  }
  return `${d}${m}${f}`;
}

export interface Evaluated {
  ratings: SectorRatings;
  hatStats: number;
}

export function evaluatePositions(positions: FieldPosition[], byId: Map<number, Player>, settings: MatchSettings, team: TeamState): Evaluated {
  const field = positions.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour }));
  const ratings = new Evaluator(settings, team).ratings(field);
  return { ratings, hatStats: hatStatsOf(ratings) };
}

/** Probleme, die das Absenden verhindern oder riskant machen */
export function lineupProblems(positions: FieldPosition[], byId: Map<number, Player>): string[] {
  const out: string[] = [];
  if (positions.length < 11) out.push(`Erst ${positions.length} von 11 Spielern aufgestellt.`);
  if (positions.length > 11) out.push(`${positions.length} Spieler auf dem Feld, erlaubt sind 11.`);
  if (!positions.some((p) => p.role === Role.keeper)) out.push("Kein Torwart aufgestellt.");
  for (const pos of positions) {
    const p = byId.get(pos.playerId);
    if (!p) continue;
    if (p.injury > 0) out.push(`${p.name} ist verletzt (${p.injury} Wochen) und kann nicht spielen.`);
    if (p.cards >= 3) out.push(`${p.name} ist gesperrt.`);
  }
  return out;
}

/** Vom Nutzer gesetzte Kapitän-, Standard- und Bankplätze; was fehlt, wählt TopHatt automatisch */
export interface LineupChoices {
  captainId?: number;
  setPiecesId?: number;
  /** Spieler-ID je Bankplatz, 0 = Platz bleibt leer */
  bench?: Partial<Record<BenchSlot, number>>;
}

/** Fertige Aufstellung mit Kapitän, Standardschütze und Bank aus den übrigen einsatzfähigen Spielern */
export function completeLineup(positions: FieldPosition[], players: Player[], settings: MatchSettings, allowBruised: boolean, choices: LineupChoices = {}): Lineup {
  const byId = new Map(players.map((p) => [p.id, p]));
  const field = positions.map((p) => byId.get(p.playerId)!).filter(Boolean);
  const ids = new Set(field.map((p) => p.id));
  // Selbst gewählte Bankspieler dürfen auch angeschlagen sein, nur nicht verletzt oder gesperrt
  const chosen = new Set(Object.values(choices.bench ?? {}).filter(Boolean));
  const rest = players.filter((p) => !ids.has(p.id) && (isAvailable(p, allowBruised) || (chosen.has(p.id) && isAvailable(p, true))));
  const onField = (id?: number) => (id && ids.has(id) ? id : 0);
  return {
    formation: formationCode(positions),
    positions: [...positions].sort((a, b) => a.role - b.role),
    bench: pickBench(rest, choices.bench),
    captainId: onField(choices.captainId) || pickCaptain(field),
    setPiecesId: onField(choices.setPiecesId) || pickSetPieces(positions.filter((p) => p.role !== Role.keeper).map((p) => byId.get(p.playerId)!).filter(Boolean)),
    tactic: settings.tactic,
    attitude: settings.attitude,
    styleOfPlay: settings.styleOfPlay,
  };
}

/** Selbst gewählter Kapitän oder Standardschütze, der nicht mehr auf dem Feld steht (wird automatisch ersetzt) */
export function droppedChoices(positions: FieldPosition[], choices: LineupChoices): { captainId?: number; setPiecesId?: number } {
  const ids = new Set(positions.map((p) => p.playerId));
  const out: { captainId?: number; setPiecesId?: number } = {};
  if (choices.captainId && !ids.has(choices.captainId)) out.captainId = choices.captainId;
  if (choices.setPiecesId && !ids.has(choices.setPiecesId)) out.setPiecesId = choices.setPiecesId;
  return out;
}

export interface SectorChange {
  sector: RatingSector;
  name: string;
  auto: number;
  mine: number;
  delta: number;
}

export interface Explanation {
  same: boolean;
  hatStatsAuto: number;
  hatStatsMine: number;
  formationAuto: string;
  formationMine: string;
  sectors: SectorChange[];
  changes: string[];
  warnings: string[];
}

const ROLE_SHORT: Record<number, string> = {
  [Role.keeper]: "TW",
  [Role.rightBack]: "RV",
  [Role.rightCentralDefender]: "IV r",
  [Role.middleCentralDefender]: "IV m",
  [Role.leftCentralDefender]: "IV l",
  [Role.leftBack]: "LV",
  [Role.rightWinger]: "RF",
  [Role.rightInnerMidfield]: "ZM r",
  [Role.centralInnerMidfield]: "ZM m",
  [Role.leftInnerMidfield]: "ZM l",
  [Role.leftWinger]: "LF",
  [Role.rightForward]: "ST r",
  [Role.centralForward]: "ST m",
  [Role.leftForward]: "ST l",
};
export const roleShort = (r: number) => ROLE_SHORT[r] ?? String(r);
const BEHAVIOUR_DE: Record<number, string> = { 0: "normal", 1: "offensiv", 2: "defensiv", 3: "zur Mitte", 4: "nach außen" };

/** Eignung relativ zum besten Spieler des Kaders in dieser Gruppe (0..1) */
function relativeFit(players: Player[]) {
  const max = new Map<LineupSector, number>();
  for (const g of GROUPS) max.set(g, Math.max(1e-6, ...players.map((p) => groupValue(p, g))));
  return (p: Player, g: LineupSector) => groupValue(p, g) / max.get(g)!;
}

export function explain(
  auto: { positions: FieldPosition[] } & Evaluated,
  mine: { positions: FieldPosition[] } & Evaluated,
  players: Player[],
  formationExperience: Record<string, number>,
): Explanation {
  const byId = new Map(players.map((p) => [p.id, p]));
  const name = (id: number) => byId.get(id)?.name ?? "?";
  const autoByRole = new Map(auto.positions.map((p) => [p.role, p]));
  const mineByRole = new Map(mine.positions.map((p) => [p.role, p]));
  const autoRoleOf = new Map(auto.positions.map((p) => [p.playerId, p.role]));
  const mineRoleOf = new Map(mine.positions.map((p) => [p.playerId, p.role]));
  const changes: string[] = [];

  // Spieler, die neu dabei sind, fehlen oder die Position gewechselt haben
  for (const pos of mine.positions) {
    const before = autoRoleOf.get(pos.playerId);
    if (before === undefined) {
      const replaced = autoByRole.get(pos.role);
      changes.push(
        replaced && !mineRoleOf.has(replaced.playerId)
          ? `${roleShort(pos.role)}: ${name(pos.playerId)} statt ${name(replaced.playerId)}.`
          : `${name(pos.playerId)} kommt neu auf ${roleShort(pos.role)}.`,
      );
    } else if (before !== pos.role) {
      changes.push(`${name(pos.playerId)} spielt ${roleShort(pos.role)} statt ${roleShort(before)}.`);
    } else if (autoByRole.get(pos.role)!.behaviour !== pos.behaviour) {
      changes.push(`${name(pos.playerId)} spielt ${BEHAVIOUR_DE[pos.behaviour]} statt ${BEHAVIOUR_DE[autoByRole.get(pos.role)!.behaviour]}.`);
    }
  }
  for (const pos of auto.positions) {
    if (mineRoleOf.has(pos.playerId)) continue;
    const taken = mineByRole.get(pos.role);
    if (taken && !autoRoleOf.has(taken.playerId)) continue; // schon als „statt“ erklärt
    changes.push(`${name(pos.playerId)} (${roleShort(pos.role)}) sitzt draußen.`);
  }

  const sectors = RATING_SECTORS.map((s) => ({ sector: s, name: SECTOR_DE[s], auto: auto.ratings[s], mine: mine.ratings[s], delta: mine.ratings[s] - auto.ratings[s] }));

  const warnings: string[] = [...lineupProblems(mine.positions, byId)];
  const fit = relativeFit(players);
  for (const pos of mine.positions) {
    const p = byId.get(pos.playerId);
    if (!p) continue;
    const g = lineupSector(pos.role);
    const best = GROUPS.reduce((a, b) => (fit(p, b) > fit(p, a) ? b : a));
    if (best !== g && fit(p, best) - fit(p, g) > 0.25) warnings.push(`${p.name} ist auf ${roleShort(pos.role)} nicht auf seiner besten Position (besser: ${GROUP_DE[best]}).`);
    if (p.injury === 0) warnings.push(`${p.name} ist angeschlagen und spielt etwas schwächer.`);
    if (p.cards === 2) warnings.push(`${p.name} hat 2 Gelbe Karten, bei der nächsten ist er gesperrt.`);
    if (p.stamina <= 5) warnings.push(`${p.name} hat Kondition ${p.stamina} und lässt in der zweiten Halbzeit deutlich nach. Wechselvorschlag unten bei den Anweisungen.`);
  }
  const fm = formationCode(mine.positions);
  const exp = formationExperience[fm] ?? 0;
  if (mine.positions.length === 11 && fm !== formationCode(auto.positions) && exp < 6)
    warnings.push(`Formation ${formationLabel(fm)} hat nur Erfahrung ${exp}. Unter 6 droht Desorganisation (Gegentore).`);

  const same = changes.length === 0 && mine.positions.length === auto.positions.length;
  return {
    same,
    hatStatsAuto: auto.hatStats,
    hatStatsMine: mine.hatStats,
    formationAuto: formationCode(auto.positions),
    formationMine: fm,
    sectors,
    changes,
    warnings,
  };
}

/** Kurztext zur Bewertungsänderung eines Mannschaftsteils */
export function sectorChangeText(c: SectorChange): string {
  if (Math.abs(c.delta) < 0.05) return `${c.name}: unverändert`;
  return `${c.name}: ${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)} (${ratingLabel(c.auto)} → ${ratingLabel(c.mine)})`;
}

