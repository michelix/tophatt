// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Kader- und Transferberater (erste Heuristiken, kein HO-Algorithmus).
// 1) Wo bringt eine Verstärkung am meisten?  -> Simulation "+1 / +2 Stufen" auf jeder Startposition
// 2) Wer ist entbehrlich?                   -> nicht in Startelf/Bank, alt, Gehalt
// 3) Wer lohnt sich zu trainieren?          -> jung + Trainingsfertigkeit

import type { Lineup, MatchSettings, Player } from "./model";
import { RATING_SECTORS, type RatingSector, type TeamState, lineupSector, playerPositionRating } from "./rating";
import { SECTOR_DE } from "./weakness";
import { Role } from "./model";
import { Evaluator, HATSTATS_OBJECTIVE, hatStatsOf } from "./optimizer";
import { TRAININGS, trainingPriority } from "./training";
import { loc } from "./locale";

type SkillKey = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring";

const MAIN_SKILLS: Record<string, SkillKey[]> = {
  goal: ["keeper"],
  back: ["defending", "winger"],
  centralDefence: ["defending"],
  wing: ["winger", "playmaking"],
  innerMidfield: ["playmaking", "passing"],
  forward: ["scoring", "passing"],
};

const SKILL_DE: Record<SkillKey, string> = {
  keeper: "Torwart",
  defending: "Verteidigung",
  playmaking: "Spielaufbau",
  passing: "Passspiel",
  winger: "Flügelspiel",
  scoring: "Torschuss",
};

const POS_DE: Record<string, string> = {
  goal: "Torwart",
  back: "Außenverteidiger",
  centralDefence: "Innenverteidiger",
  wing: "Flügelspieler",
  innerMidfield: "Zentrales Mittelfeld",
  forward: "Sturm",
};

export interface UpgradeHint {
  position: string;
  currentPlayer: string;
  skill: string;
  gainPlus1: number;
  gainPlus2: number;
  /** HatStats-Zuwachs (+2 Stufen), der in schwachen Mannschaftsteilen ankommt */
  weakGain: number;
  /** schwache Mannschaftsteile, die davon profitieren */
  helps: string[];
}

export interface SquadHint {
  playerId: number;
  name: string;
  reason: string;
}

export interface Advice {
  upgrades: UpgradeHint[];
  sellCandidates: SquadHint[];
  trainingTargets: SquadHint[];
  summary: string[];
}

export function advise(
  players: Player[],
  lineup: Pick<Lineup, "positions"> & Partial<Lineup>,
  settings: MatchSettings,
  team: TeamState,
  trainingType: number,
  weakSectors: ReadonlySet<RatingSector> = new Set(),
): Advice {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ev = new Evaluator(settings, team);
  const field = lineup.positions.map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour })).filter((f) => f.player);
  const baseR = ev.ratings(field);
  const base = hatStatsOf(baseR);

  // 1) Verstärkungs-Simulation
  const upgrades: UpgradeHint[] = [];
  const seenSector = new Set<string>();
  const candidates: UpgradeHint[] = [];
  for (let i = 0; i < field.length; i++) {
    const sector = lineupSector(field[i].role);
    for (const skill of MAIN_SKILLS[sector]) {
      const boostedRatings = (delta: number) => {
        // eigene Fantasie-ID je Variante, damit der Beitrags-Cache nicht greift
        const boosted = { ...field[i].player, id: -(1000 * delta + 10 * i + MAIN_SKILLS[sector].indexOf(skill) + 1), [skill]: field[i].player[skill] + delta };
        const f2 = field.map((f, j) => (j === i ? { ...f, player: boosted } : f));
        return ev.ratings(f2);
      };
      const r2 = boostedRatings(2);
      // nur der Teil des Zuwachses, der in schwachen Mannschaftsteilen ankommt
      const mixed = { ...baseR };
      for (const k of weakSectors) mixed[k] = r2[k];
      const helps = RATING_SECTORS.filter((k) => weakSectors.has(k) && r2[k] - baseR[k] > 0.02).map((k) => SECTOR_DE[k]);
      candidates.push({
        position: POS_DE[sector],
        currentPlayer: field[i].player.name,
        skill: SKILL_DE[skill],
        gainPlus1: hatStatsOf(boostedRatings(1)) - base,
        gainPlus2: hatStatsOf(r2) - base,
        weakGain: hatStatsOf(mixed) - base,
        helps,
      });
    }
  }
  // Schwachstellen zuerst, dann der Gesamtzuwachs
  candidates.sort((a, b) => b.weakGain - a.weakGain || b.gainPlus2 - a.gainPlus2);
  for (const c of candidates) {
    const key = c.position + c.skill;
    if (seenSector.has(key)) continue;
    seenSector.add(key);
    upgrades.push(c);
    if (upgrades.length >= 6) break;
  }

  // 2) Entbehrliche Spieler
  const inLineup = new Set([...lineup.positions.map((p) => p.playerId), ...Object.values(lineup.bench ?? {})]);
  const sellCandidates: SquadHint[] = [];
  for (const p of players) {
    if (inLineup.has(p.id)) continue;
    const reasons: string[] = [];
    if (p.age >= 28) reasons.push(`${p.age} Jahre, entwickelt sich kaum noch`);
    if (p.salary >= 1000) reasons.push(`Gehalt ${Math.round(p.salary).toLocaleString(loc())} €/Woche`);
    // Verletzte sind nur vorübergehend nicht in der Elf – kein Verkaufsgrund
    if (p.injury > 0) continue;
    if (reasons.length) sellCandidates.push({ playerId: p.id, name: p.name, reason: `Weder Startelf noch Bank; ${reasons.join(", ")}.` });
  }
  const keepers = players.filter((p) => p.keeper >= Math.max(p.defending, p.playmaking, p.scoring, p.winger, p.passing));
  if (keepers.length > 2) {
    // die zwei stärksten Torhüter (inkl. Form, Treue, Erfahrung) behalten
    const sorted = [...keepers].sort((a, b) => playerPositionRating(b, Role.keeper) - playerPositionRating(a, Role.keeper));
    for (const k of sorted.slice(2)) {
      if (!sellCandidates.some((s) => s.playerId === k.id) && !inLineup.has(k.id))
        sellCandidates.push({ playerId: k.id, name: k.name, reason: `${keepers.length} Torhüter im Kader, zwei reichen. Gehalt ${Math.round(k.salary).toLocaleString(loc())} €/Woche.` });
    }
  }

  // 3) Trainingskandidaten
  const t = TRAININGS[trainingType];
  const trainingTargets: SquadHint[] = [];
  if (t) {
    const isKeeper = (p: Player) => p.keeper > Math.max(p.defending, p.playmaking, p.scoring, p.winger, p.passing);
    const ranked = [...players].filter((p) => p.injury <= 0 && (t.skill === "keeper" || !isKeeper(p))).sort((a, b) => trainingPriority(b, t) - trainingPriority(a, t));
    for (const p of ranked.slice(0, 6)) {
      trainingTargets.push({ playerId: p.id, name: p.name, reason: `${p.age} Jahre, ${t.name} ${p[t.skill]} – lohnt sich zu trainieren.` });
    }
  }

  const summary: string[] = [];
  const top = upgrades[0];
  const overall = [...candidates].sort((a, b) => b.gainPlus2 - a.gainPlus2)[0];
  if (top && top.weakGain > 0.05) {
    summary.push(
      `Größter Hebel für die Schwachstellen: ${top.position} (${top.skill}). Ein Spieler mit +2 Stufen gegenüber ${top.currentPlayer} stärkt ${top.helps.join(", ")} und bringt etwa +${top.gainPlus2.toFixed(1)} HatStats.`,
    );
    if (overall && overall.gainPlus2 > top.gainPlus2 + 0.5 && overall.weakGain <= 0.05)
      summary.push(
        `Rein nach HatStats brächte ${overall.position} (${overall.skill}) mehr (+${overall.gainPlus2.toFixed(1)}), weil er mehrere Mannschaftsteile gleichzeitig hebt. Die sind aber schon solide, deshalb steht er hinten.`,
      );
  } else if (overall) {
    summary.push(`Keine deutliche Schwachstelle. Größter Hebel nach HatStats: ${overall.position} (${overall.skill}), etwa +${overall.gainPlus2.toFixed(1)} HatStats bei +2 Stufen gegenüber ${overall.currentPlayer}.`);
  }
  if (sellCandidates.length) summary.push(`${sellCandidates.length} Spieler kommen weder in die Startelf noch auf die Bank – Verkauf prüfen, das spart Gehalt.`);
  return { upgrades, sellCandidates, trainingTargets, summary };
}
