// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Trainingsplanung: welche Positionen werden beim eingestellten Training voll/teilweise trainiert,
// und eine Freundschaftsspiel-Aufstellung, damit alle 22 Spieler Training bekommen.
// Positionsgruppen je Trainingsart aus HO core/training/type/*WeeklyTraining.java.

import type { BehaviourId, Lineup, Player, RoleId } from "./model";
import { Behaviour, Role } from "./model";
import { type LineupSector, lineupSector, playerPositionRating } from "./rating";
import { FORMATIONS, formationVariants, isAvailable, pickCaptain, pickSetPieces } from "./optimizer";

type SkillKey = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring" | "setPieces";

export interface TrainingDef {
  name: string;
  skill: SkillKey;
  full: LineupSector[];
  partly: LineupSector[];
}

export const TRAININGS: Record<number, TrainingDef> = {
  2: { name: "Standards", skill: "setPieces", full: ["goal", "back", "centralDefence", "wing", "innerMidfield", "forward"], partly: [] },
  3: { name: "Verteidigung", skill: "defending", full: ["centralDefence", "back"], partly: [] },
  4: { name: "Torschuss", skill: "scoring", full: ["forward"], partly: [] },
  5: { name: "Flanken", skill: "winger", full: ["wing"], partly: ["back"] },
  6: { name: "Schusstraining", skill: "scoring", full: ["goal", "back", "centralDefence", "wing", "innerMidfield", "forward"], partly: [] },
  7: { name: "Kurzpässe", skill: "passing", full: ["wing", "innerMidfield", "forward"], partly: [] },
  8: { name: "Spielaufbau", skill: "playmaking", full: ["innerMidfield"], partly: ["wing"] },
  9: { name: "Torwart", skill: "keeper", full: ["goal"], partly: [] },
  10: { name: "Steilpässe", skill: "passing", full: ["back", "centralDefence", "wing", "innerMidfield"], partly: [] },
  11: { name: "Defensives Stellungsspiel", skill: "defending", full: ["goal", "back", "centralDefence", "wing", "innerMidfield"], partly: [] },
  12: { name: "Angriff über die Flügel", skill: "winger", full: ["wing", "forward"], partly: [] },
};

export type TrainingLevel = "voll" | "teilweise" | "keins";

export function trainingFor(role: number, t: TrainingDef): TrainingLevel {
  const s = lineupSector(role);
  if (t.full.includes(s)) return "voll";
  if (t.partly.includes(s)) return "teilweise";
  return "keins";
}

/**
 * Trainingsnutzen: jung, Trainingsfertigkeit ist eine seiner Hauptfertigkeiten, und die Fertigkeit ist noch
 * niedrig (in Hattrick steigt eine niedrige Fertigkeit schneller). Ergebnis grob 0..10, nur zum Sortieren.
 */
export function trainingPriority(p: Player, t: TrainingDef): number {
  const skills: SkillKey[] = ["keeper", "defending", "playmaking", "passing", "winger", "scoring"];
  const sorted = [...skills].sort((a, b) => p[b] - p[a]);
  const rank = sorted.indexOf(t.skill as SkillKey);
  const relevance = t.skill === "setPieces" ? 1 : rank === 0 ? 1 : rank === 1 ? 0.7 : rank === 2 ? 0.4 : 0.15;
  const youth = Math.max(0, 31 - p.age) / 13; // 18 J. = 1,0 ; 31 J. = 0
  const level = Math.min(1, Math.max(0, (16 - p[t.skill]) / 12)); // Fertigkeit 4 = 1,0 ; 16 = 0
  return 10 * relevance * (0.3 + 0.55 * youth + 0.15 * level);
}

// --- Trainingswoche ------------------------------------------------------------------------
// Regeln wie in HO (TrainingWeekPlayer, WeeklyTrainingType.calcTrainingFactor): Die Minuten aller Spiele
// zwischen zwei Trainingsupdates werden addiert, höchstens 90 zählen. Minuten auf voller Trainingsposition
// zählen zuerst, Minuten auf teilweiser Position (50 %) füllen bis 90 auf.

export interface WeekMinutes {
  full: number;
  partly: number;
  /** Herkunft für die Anzeige, z. B. "Liga ZM gespielt" */
  sources: string[];
}

/**
 * Ab diesem Anteil gilt ein Spieler als praktisch fertig trainiert: Mehr als 5 % kann er diese Woche nicht mehr
 * dazugewinnen (z. B. 89 von 90 Minuten = 99 %). Solche Spieler bekommen keine Trainingsplätze mehr.
 */
export const DONE_FACTOR = 0.95;

/** Trainingswirkung der Woche, 0 … 1 (1 = 90 Minuten volles Training) */
export function weekFactor(m: Pick<WeekMinutes, "full" | "partly"> | undefined): number {
  if (!m) return 0;
  const full = Math.min(90, m.full);
  const partly = Math.min(90 - full, m.partly);
  return (full + 0.5 * partly) / 90;
}

export interface TrainingWindow {
  /** letztes Trainingsupdate (Beginn der laufenden Trainingswoche) */
  start: Date;
  /** nächstes Trainingsupdate */
  end: Date;
}

/**
 * Laufende Trainingswoche aus den Trainingsterminen (HO-Tabellen TRAINING/FUTURETRAINING).
 * Ohne Termine: Trainingsupdate freitags 00:30 (Deutschland).
 */
export function trainingWindow(now: Date, trainingDates: Date[]): TrainingWindow {
  const t = now.getTime();
  const valid = trainingDates.filter((d) => !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  const past = valid.filter((d) => d.getTime() <= t);
  const next = valid.find((d) => d.getTime() > t);
  let start = past[past.length - 1];
  if (!start || t - start.getTime() > 7 * 864e5) {
    start = new Date(now);
    start.setHours(0, 30, 0, 0);
    while (start.getDay() !== 5 || start.getTime() > t) start.setDate(start.getDate() - 1);
  }
  const end = next && next.getTime() - start.getTime() <= 8 * 864e5 ? next : new Date(start.getTime() + 7 * 864e5);
  return { start, end };
}

/**
 * Trainingswoche für die Planung des nächsten eigenen Spiels. Liegt das Spiel nach dem nächsten Trainingsupdate
 * (z. B. Mittwoch, Liga am Samstag und Pokal am Dienstag schon gespielt), ist die laufende Woche abgeschlossen:
 * Das Spiel zählt für die Woche danach, in der noch niemand gespielt hat.
 */
export function planningWindow(now: Date, trainingDates: Date[], nextMatch?: Date | null): TrainingWindow {
  const w = trainingWindow(now, trainingDates);
  if (!nextMatch || isNaN(nextMatch.getTime()) || nextMatch.getTime() < w.end.getTime()) return w;
  return trainingWindow(nextMatch, trainingDates);
}

const POS_SHORT: Record<number, string> = { 100: "TW", 101: "AV", 102: "IV", 103: "IV", 104: "IV", 105: "AV", 106: "FL", 107: "ZM", 108: "ZM", 109: "ZM", 110: "FL", 111: "ST", 112: "ST", 113: "ST" };
export const positionShort = (role: number) => POS_SHORT[role] ?? "";

function add(map: Map<number, WeekMinutes>, id: number, role: number, minutes: number, t: TrainingDef, label: string) {
  const m = map.get(id) ?? { full: 0, partly: 0, sources: [] };
  const lvl = trainingFor(role, t);
  if (lvl === "voll") m.full = Math.min(90, m.full + minutes);
  if (lvl === "teilweise") m.partly = Math.min(90, m.partly + minutes);
  m.sources.push(`${label} ${positionShort(role)}${minutes < 90 ? ` ${minutes}′` : ""}`.trim());
  map.set(id, m);
}

/**
 * Was diese Trainingswoche schon gespielt wurde, aus dem letzten Spiel jedes Spielers laut HRF
 * (LastMatch_Date/PositionCode/PlayedMinutes). Nur das jeweils letzte Spiel ist bekannt.
 */
export function playedThisWeek(players: Player[], t: TrainingDef, w: TrainingWindow): Map<number, WeekMinutes> {
  const map = new Map<number, WeekMinutes>();
  for (const p of players) {
    if (!p.lastMatchDate || !p.lastMatchMinutes || p.lastMatchPosition < 100 || p.lastMatchPosition > 113) continue;
    const d = new Date(p.lastMatchDate.replace(" ", "T"));
    if (isNaN(d.getTime()) || d.getTime() < w.start.getTime() || d.getTime() >= w.end.getTime()) continue;
    add(map, p.id, p.lastMatchPosition, Math.min(90, p.lastMatchMinutes), t, "gespielt");
  }
  return map;
}

/** Geplante Aufstellung dazurechnen (90 Minuten je Feldspieler) */
export function addPlanned(base: Map<number, WeekMinutes>, positions: { role: number; playerId: number }[], t: TrainingDef, label: string): Map<number, WeekMinutes> {
  const map = new Map([...base].map(([k, v]) => [k, { ...v, sources: [...v.sources] }]));
  for (const p of positions) if (p.role >= 100 && p.role <= 113) add(map, p.playerId, p.role, 90, t, label);
  return map;
}

/** Bei gleich vielen Trainingsplätzen: ausgewogene Formationen vor exotischen */
export const FORMATION_PREFERENCE = ["442", "451", "352", "433", "541", "532", "343", "523", "253", "550"];

/**
 * Höchstzahl Trainingsplätze in einem Spiel und die Formation dafür. Bei Gleichstand gewinnt die Formation
 * mit der meisten Erfahrung, dann die ausgewogenere (4-5-1 vor 5-5-0).
 */
export function maxTrainingSlots(t: TrainingDef, formationExperience: Record<string, number> = {}): { full: number; partly: number; formation: string } {
  let best = { full: 0, partly: 0, formation: "442" };
  let bestKey = -Infinity;
  for (const f of FORMATIONS)
    for (const roles of formationVariants(f)) {
      const full = roles.filter((r) => trainingFor(r, t) === "voll").length;
      const partly = roles.filter((r) => trainingFor(r, t) === "teilweise").length;
      const pref = FORMATION_PREFERENCE.indexOf(f);
      const key = (full * 10 + partly) * 1e4 + (formationExperience[f] ?? 0) * 100 - (pref < 0 ? 99 : pref);
      if (key > bestKey) {
        bestKey = key;
        best = { full, partly, formation: f };
      }
    }
  return best;
}

/** Trainingsplätze einer Formation (Variante mit den meisten) */
export function formationSlots(t: TrainingDef, formation: string): { full: number; partly: number; roles: RoleId[] } {
  let best = { full: -1, partly: -1, roles: [] as RoleId[] };
  for (const roles of formationVariants(formation)) {
    const full = roles.filter((r) => trainingFor(r, t) === "voll").length;
    const partly = roles.filter((r) => trainingFor(r, t) === "teilweise").length;
    if (full * 10 + partly > best.full * 10 + best.partly) best = { full, partly, roles };
  }
  return best;
}

export interface TrainingLineupPlan {
  lineup: Lineup;
  /** Trainingswirkung je Spieler nach diesem Spiel (inkl. schon gespielter/geplanter Minuten) */
  after: Map<number, WeekMinutes>;
  /** Spieler, die durch dieses Spiel Training dazubekommen */
  gaining: number[];
  notes: string[];
}

/**
 * Aufstellung, die möglichst viel zusätzliches Training bringt: Trainingsplätze bekommen die Spieler, die noch
 * am wenigsten Training haben und am meisten davon haben (jung, Trainingsfertigkeit ist eine Hauptfertigkeit).
 * Formation mit den meisten Trainingsplätzen.
 */
export function planTrainingLineup(
  players: Player[],
  trainingType: number,
  before: Map<number, WeekMinutes>,
  allowBruised = false,
  formationExperience: Record<string, number> = {},
  /** feste Formation (Formationsauswahl); sonst die mit den meisten Trainingsplätzen */
  forceFormation?: string,
  /** Spieler, die nicht mehr trainiert werden sollen (Verkauf, Entlassung): keine Trainingsplätze */
  exclude: ReadonlySet<number> = new Set(),
): TrainingLineupPlan {
  const t = TRAININGS[trainingType];
  if (!t) throw new Error(`Unbekannte Trainingsart ${trainingType}`);
  const available = players.filter((p) => isAvailable(p, allowBruised));
  const formation = forceFormation && (FORMATIONS as readonly string[]).includes(forceFormation) ? forceFormation : maxTrainingSlots(t, formationExperience).formation;
  const slots = formationSlots(t, formation);
  const bestRoles = slots.roles;
  const fullRoles = bestRoles.filter((r) => trainingFor(r, t) === "voll");
  const partlyRoles = bestRoles.filter((r) => trainingFor(r, t) === "teilweise");
  const otherRoles = bestRoles.filter((r) => trainingFor(r, t) === "keins");

  const isKeeperType = (p: Player) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);
  const gain = (p: Player, lvl: "voll" | "teilweise") => {
    const m = before.get(p.id) ?? { full: 0, partly: 0 };
    const after = lvl === "voll" ? { full: m.full + 90, partly: m.partly } : { full: m.full, partly: m.partly + 90 };
    return (weekFactor(after) - weekFactor(m)) * trainingPriority(p, t);
  };
  const playsElsewhere = (p: Player) => (before.get(p.id)?.sources.length ?? 0) > 0;

  const used = new Set<number>();
  const assign: { role: RoleId; player: Player }[] = [];
  const fillRole = (role: RoleId, candidates: Player[]) => {
    let best: Player | null = null,
      bv = -1;
    for (const p of candidates) {
      if (used.has(p.id)) continue;
      const v = playerPositionRating(p, role);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      assign.push({ role, player: best });
    }
    return best;
  };
  const trainees = (lvl: "voll" | "teilweise") =>
    available
      .filter((p) => !used.has(p.id) && !exclude.has(p.id) && weekFactor(before.get(p.id)) < DONE_FACTOR && (t.skill === "keeper" || !isKeeperType(p)) && gain(p, lvl) > 0.01)
      .sort((a, b) => gain(b, lvl) - gain(a, lvl));

  // 1) volle Trainingsplätze, dann 2) teilweise: streng nach Trainingsnutzen. Die Spieler mit dem größten Gewinn
  // bekommen die Plätze; nur welcher von ihnen auf welche Trainingsposition kommt, entscheidet die Positionsstärke.
  for (const [roles, lvl] of [
    [fullRoles, "voll"],
    [partlyRoles, "teilweise"],
  ] as const) {
    const keeperRoles = roles.filter((r) => r === Role.keeper);
    const fieldRoles = roles.filter((r) => r !== Role.keeper);
    for (const role of keeperRoles) fillRole(role, trainees(lvl).filter(isKeeperType).slice(0, 1));
    const chosen = trainees(lvl).filter((p) => !isKeeperType(p) || t.skill === "keeper").slice(0, fieldRoles.length);
    const open: RoleId[] = [...fieldRoles];
    // jeweils das passendste Paar aus Spieler und Position zuerst
    while (open.length && chosen.some((p) => !used.has(p.id))) {
      let best: { role: RoleId; p: Player; v: number } | null = null;
      for (const role of open)
        for (const p of chosen) {
          if (used.has(p.id)) continue;
          const v = playerPositionRating(p, role);
          if (!best || v > best.v) best = { role, p, v };
        }
      if (!best) break;
      used.add(best.p.id);
      assign.push({ role: best.role, player: best.p });
      open.splice(open.indexOf(best.role), 1);
    }
    for (const role of open) fillRole(role, available.filter((p) => !playsElsewhere(p) && !isKeeperType(p)));
  }
  // 3) übrige Plätze: wer sonst nicht spielt, nach Positionsstärke; notfalls alle
  const unfilled = [...fullRoles, ...partlyRoles].filter((r) => !assign.some((a) => a.role === r));
  // (Torhüter nur ins Tor, solange es Feldspieler gibt)
  for (const role of [...otherRoles, ...unfilled]) {
    const fits = role === Role.keeper ? available.filter(isKeeperType) : available.filter((p) => !isKeeperType(p));
    if (!fillRole(role, fits.filter((p) => !playsElsewhere(p))) && !fillRole(role, fits)) fillRole(role, available);
  }

  const lineup: Lineup = {
    formation,
    positions: assign.map((a) => ({ role: a.role, playerId: a.player.id, behaviour: Behaviour.normal as BehaviourId })).sort((a, b) => a.role - b.role),
    bench: {},
    captainId: pickCaptain(assign.map((a) => a.player)),
    setPiecesId: pickSetPieces(assign.filter((a) => a.role !== Role.keeper).map((a) => a.player)),
    tactic: 0,
    attitude: 0,
    styleOfPlay: 0,
  };
  const after = addPlanned(before, lineup.positions, t, "neu");
  const gaining = lineup.positions.map((p) => p.playerId).filter((id) => weekFactor(after.get(id)) > weekFactor(before.get(id)) + 1e-9);
  const notes: string[] = [];
  if (assign.length < 11) notes.push(`Nur ${assign.length} einsatzfähige Spieler.`);
  const doubles = assign.filter((a) => playsElsewhere(a.player));
  if (doubles.length) notes.push(doubles.length === 1 ? "Ein Spieler davon spielt diese Woche schon oder ist schon eingeplant." : `${doubles.length} Spieler davon spielen diese Woche schon oder sind schon eingeplant.`);
  return { lineup, after, gaining, notes };
}

export interface FriendlyPlan {
  lineup: Lineup;
  /** Spieler, die in der Liga (gespielt oder geplant) schon volles Training haben */
  trainedInLeague: number[];
  /** Spieler, die im Freundschaftsspiel auf einer Trainingsposition stehen */
  trainedInFriendly: number[];
  /** Spieler, die diese Woche kein Training bekommen */
  untrained: number[];
  /** Minuten je Spieler nach beiden Spielen */
  week: Map<number, WeekMinutes>;
  notes: string[];
}

/**
 * Freundschaftsspiel: Spieler, die diese Woche noch nicht (voll) trainiert werden, kommen auf die
 * Trainingspositionen. `played` = schon gespielte Minuten dieser Woche (aus der HRF); die Liga-Aufstellung
 * zählt dazu, solange das Ligaspiel noch in dieser Trainingswoche liegt (sonst leere Aufstellung übergeben).
 */
export function planFriendly(
  players: Player[],
  league: { positions: { role: number; playerId: number }[] },
  trainingType: number,
  allowBruised = false,
  played = new Map<number, WeekMinutes>(),
  formationExperience: Record<string, number> = {},
  exclude: ReadonlySet<number> = new Set(),
): FriendlyPlan {
  const t = TRAININGS[trainingType];
  if (!t) throw new Error(`Unbekannte Trainingsart ${trainingType}`);
  const before = addPlanned(played, league.positions, t, "Liga");
  const plan = planTrainingLineup(players, trainingType, before, allowBruised, formationExperience, undefined, exclude);
  const available = players.filter((p) => isAvailable(p, allowBruised) || before.has(p.id));
  const trainedInLeague = [...before].filter(([, m]) => weekFactor(m) >= 1).map(([id]) => id);
  const trainedInFriendly = plan.lineup.positions.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId);
  const untrained = available.filter((p) => weekFactor(plan.after.get(p.id)) === 0).map((p) => p.id);
  const slots = maxTrainingSlots(t);
  const notes = [...plan.notes];
  notes.push(
    `Höchstens ${2 * slots.full} Spieler pro Woche voll „${t.name}“ (${slots.full} je Spiel${slots.partly ? `, dazu ${2 * slots.partly} mit halbem Training auf ${t.partly.includes("wing") ? "dem Flügel" : "Teilpositionen"}` : ""}). Diese Woche: ${plan.lineup.positions.length ? [...plan.after.values()].filter((m) => weekFactor(m) >= 1).length : trainedInLeague.length} voll.`,
  );
  notes.push("Freundschaftsspiele sind nur in Wochen ohne Pokalspiel möglich.");
  return { lineup: plan.lineup, trainedInLeague, trainedInFriendly, untrained, week: plan.after, notes };
}
