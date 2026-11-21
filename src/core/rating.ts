// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Bewertungsmodell (Ratings, HatStats) – TypeScript-Portierung von
// Hattrick Organizer core/rating/RatingPredictionModel.java (LGPL-3.0).
// Die Formeln stammen von "Schum": Σ [ (S+Eff(L)) * K(F) * C * K(P) + Eff(Exp) ]
// Nicht übernommen: Wetter (immer neutral), Manndeckung, Auswechslungen im Spielverlauf.

import type { Lineup, MatchSettings, Player, RoleId, BehaviourId } from "./model";
import { Attitude, Behaviour, Location, Role, Specialty, Tactic } from "./model";

export type RatingSector =
  | "defenceLeft"
  | "defenceCentral"
  | "defenceRight"
  | "midfield"
  | "attackLeft"
  | "attackCentral"
  | "attackRight";

export const RATING_SECTORS: RatingSector[] = [
  "defenceLeft",
  "defenceCentral",
  "defenceRight",
  "midfield",
  "attackLeft",
  "attackCentral",
  "attackRight",
];

export type LineupSector = "goal" | "back" | "centralDefence" | "wing" | "innerMidfield" | "forward";

export function lineupSector(role: number): LineupSector {
  switch (role) {
    case Role.keeper:
      return "goal";
    case Role.leftBack:
    case Role.rightBack:
      return "back";
    case Role.leftCentralDefender:
    case Role.middleCentralDefender:
    case Role.rightCentralDefender:
      return "centralDefence";
    case Role.leftWinger:
    case Role.rightWinger:
      return "wing";
    case Role.leftInnerMidfield:
    case Role.centralInnerMidfield:
    case Role.rightInnerMidfield:
      return "innerMidfield";
    default:
      return "forward";
  }
}

type Skill = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring";
type ParamSet = "sideDefence" | "centralDefence" | "midfield" | "sideAttack" | "centralAttack";
type Side = "left" | "middle" | "right";
type SideRestriction = "none" | "thisSide" | "middleOnly" | "oppositeSide";

const SECTOR_PARAMS: Record<RatingSector, { set: ParamSet; side: Side }> = {
  defenceLeft: { set: "sideDefence", side: "left" },
  defenceCentral: { set: "centralDefence", side: "middle" },
  defenceRight: { set: "sideDefence", side: "right" },
  midfield: { set: "midfield", side: "middle" },
  attackLeft: { set: "sideAttack", side: "left" },
  attackCentral: { set: "centralAttack", side: "middle" },
  attackRight: { set: "sideAttack", side: "right" },
};

interface Contribution {
  set: ParamSet;
  skill: Skill;
  sector: LineupSector;
  restriction: SideRestriction;
  behaviour: BehaviourId;
  value: number;
  /** abweichender Wert für bestimmte Spezialität */
  specialty?: { specialty: Specialty; value: number };
}

const N = Behaviour.normal,
  O = Behaviour.offensive,
  D = Behaviour.defensive,
  TM = Behaviour.towardsMiddle,
  TW = Behaviour.towardsWing;

const c = (
  set: ParamSet,
  skill: Skill,
  sector: LineupSector,
  restriction: SideRestriction,
  behaviour: BehaviourId,
  value: number,
  specialty?: Contribution["specialty"],
): Contribution => ({ set, skill, sector, restriction, behaviour, value, specialty });

// Tabelle 1:1 aus HO initRatingContributionParameterMap()
const CONTRIBUTIONS: Contribution[] = [
  // Seitliche Abwehr
  c("sideDefence", "keeper", "goal", "none", N, 0.61),
  c("sideDefence", "defending", "goal", "none", N, 0.25),
  c("sideDefence", "defending", "centralDefence", "thisSide", N, 0.52),
  c("sideDefence", "defending", "centralDefence", "thisSide", O, 0.4),
  c("sideDefence", "defending", "centralDefence", "thisSide", TW, 0.81),
  c("sideDefence", "defending", "centralDefence", "middleOnly", N, 0.26),
  c("sideDefence", "defending", "centralDefence", "middleOnly", O, 0.2),
  c("sideDefence", "defending", "back", "thisSide", N, 0.92),
  c("sideDefence", "defending", "back", "thisSide", O, 0.74),
  c("sideDefence", "defending", "back", "thisSide", D, 1),
  c("sideDefence", "defending", "back", "thisSide", TM, 0.75),
  c("sideDefence", "defending", "innerMidfield", "thisSide", N, 0.19),
  c("sideDefence", "defending", "innerMidfield", "thisSide", O, 0.09),
  c("sideDefence", "defending", "innerMidfield", "thisSide", D, 0.27),
  c("sideDefence", "defending", "innerMidfield", "thisSide", TW, 0.24),
  c("sideDefence", "defending", "innerMidfield", "middleOnly", N, 0.095),
  c("sideDefence", "defending", "innerMidfield", "middleOnly", O, 0.045),
  c("sideDefence", "defending", "innerMidfield", "middleOnly", D, 0.135),
  c("sideDefence", "defending", "wing", "thisSide", N, 0.35),
  c("sideDefence", "defending", "wing", "thisSide", O, 0.22),
  c("sideDefence", "defending", "wing", "thisSide", D, 0.61),
  c("sideDefence", "defending", "wing", "thisSide", TM, 0.29),
  // Zentrale Abwehr
  c("centralDefence", "keeper", "goal", "none", N, 0.87),
  c("centralDefence", "defending", "goal", "none", N, 0.35),
  c("centralDefence", "defending", "centralDefence", "none", N, 1),
  c("centralDefence", "defending", "centralDefence", "none", O, 0.73),
  c("centralDefence", "defending", "centralDefence", "none", TW, 0.67),
  c("centralDefence", "defending", "back", "none", N, 0.38),
  c("centralDefence", "defending", "back", "none", O, 0.35),
  c("centralDefence", "defending", "back", "none", D, 0.43),
  c("centralDefence", "defending", "back", "none", TM, 0.7),
  c("centralDefence", "defending", "innerMidfield", "none", N, 0.4),
  c("centralDefence", "defending", "innerMidfield", "none", O, 0.16),
  c("centralDefence", "defending", "innerMidfield", "none", D, 0.58),
  c("centralDefence", "defending", "innerMidfield", "none", TW, 0.33),
  c("centralDefence", "defending", "wing", "none", N, 0.2),
  c("centralDefence", "defending", "wing", "none", O, 0.13),
  c("centralDefence", "defending", "wing", "none", D, 0.25),
  c("centralDefence", "defending", "wing", "none", TM, 0.25),
  // Mittelfeld
  c("midfield", "playmaking", "centralDefence", "none", N, 0.25),
  c("midfield", "playmaking", "centralDefence", "none", O, 0.4),
  c("midfield", "playmaking", "centralDefence", "none", TW, 0.15),
  c("midfield", "playmaking", "back", "none", N, 0.15),
  c("midfield", "playmaking", "back", "none", O, 0.2),
  c("midfield", "playmaking", "back", "none", D, 0.1),
  c("midfield", "playmaking", "back", "none", TM, 0.2),
  c("midfield", "playmaking", "innerMidfield", "none", N, 1),
  c("midfield", "playmaking", "innerMidfield", "none", O, 0.95),
  c("midfield", "playmaking", "innerMidfield", "none", D, 0.95),
  c("midfield", "playmaking", "innerMidfield", "none", TW, 0.9),
  c("midfield", "playmaking", "wing", "none", N, 0.45),
  c("midfield", "playmaking", "wing", "none", O, 0.3),
  c("midfield", "playmaking", "wing", "none", D, 0.3),
  c("midfield", "playmaking", "wing", "none", TM, 0.55),
  c("midfield", "playmaking", "forward", "none", N, 0.25),
  c("midfield", "playmaking", "forward", "none", D, 0.35),
  c("midfield", "playmaking", "forward", "none", TW, 0.15),
  // Zentraler Angriff
  c("centralAttack", "passing", "innerMidfield", "none", N, 0.33),
  c("centralAttack", "passing", "innerMidfield", "none", O, 0.49),
  c("centralAttack", "passing", "innerMidfield", "none", D, 0.18),
  c("centralAttack", "passing", "innerMidfield", "none", TW, 0.23),
  c("centralAttack", "passing", "wing", "none", N, 0.11),
  c("centralAttack", "passing", "wing", "none", O, 0.13),
  c("centralAttack", "passing", "wing", "none", D, 0.05),
  c("centralAttack", "passing", "wing", "none", TM, 0.16),
  c("centralAttack", "passing", "forward", "none", N, 0.33),
  c("centralAttack", "passing", "forward", "none", D, 0.53),
  c("centralAttack", "passing", "forward", "none", TW, 0.23),
  c("centralAttack", "scoring", "innerMidfield", "none", N, 0.22),
  c("centralAttack", "scoring", "innerMidfield", "none", O, 0.31),
  c("centralAttack", "scoring", "innerMidfield", "none", D, 0.13),
  c("centralAttack", "scoring", "forward", "none", N, 1),
  c("centralAttack", "scoring", "forward", "none", D, 0.56),
  c("centralAttack", "scoring", "forward", "none", TW, 0.66),
  // Seitlicher Angriff
  c("sideAttack", "passing", "innerMidfield", "middleOnly", N, 0.13),
  c("sideAttack", "passing", "innerMidfield", "middleOnly", O, 0.18),
  c("sideAttack", "passing", "innerMidfield", "middleOnly", D, 0.07),
  c("sideAttack", "passing", "forward", "none", N, 0.14),
  c("sideAttack", "passing", "forward", "none", D, 0.31, { specialty: Specialty.Technical, value: 0.41 }),
  c("sideAttack", "passing", "innerMidfield", "thisSide", N, 0.26),
  c("sideAttack", "passing", "innerMidfield", "thisSide", O, 0.36),
  c("sideAttack", "passing", "innerMidfield", "thisSide", D, 0.14),
  c("sideAttack", "passing", "innerMidfield", "thisSide", TW, 0.31),
  c("sideAttack", "passing", "wing", "thisSide", N, 0.26),
  c("sideAttack", "passing", "wing", "thisSide", O, 0.29),
  c("sideAttack", "passing", "wing", "thisSide", D, 0.21),
  c("sideAttack", "passing", "wing", "thisSide", TM, 0.15),
  c("sideAttack", "passing", "forward", "thisSide", TW, 0.21),
  c("sideAttack", "passing", "forward", "oppositeSide", TW, 0.06),
  c("sideAttack", "winger", "centralDefence", "thisSide", TW, 0.26),
  c("sideAttack", "winger", "back", "thisSide", N, 0.59),
  c("sideAttack", "winger", "back", "thisSide", O, 0.69),
  c("sideAttack", "winger", "back", "thisSide", D, 0.45),
  c("sideAttack", "winger", "back", "thisSide", TM, 0.35),
  c("sideAttack", "winger", "innerMidfield", "thisSide", TW, 0.59),
  c("sideAttack", "winger", "wing", "thisSide", N, 0.86),
  c("sideAttack", "winger", "wing", "thisSide", O, 1),
  c("sideAttack", "winger", "wing", "thisSide", D, 0.69),
  c("sideAttack", "winger", "wing", "thisSide", TM, 0.74),
  c("sideAttack", "winger", "forward", "none", N, 0.24),
  c("sideAttack", "winger", "forward", "none", D, 0.13),
  c("sideAttack", "winger", "forward", "thisSide", TW, 0.64),
  c("sideAttack", "winger", "forward", "oppositeSide", TW, 0.21),
  c("sideAttack", "scoring", "forward", "none", N, 0.27),
  c("sideAttack", "scoring", "forward", "none", D, 0.13),
  c("sideAttack", "scoring", "forward", "oppositeSide", TW, 0.19),
  c("sideAttack", "scoring", "forward", "thisSide", TW, 0.51),
];

const LEFT_ROLES = new Set<number>([Role.leftBack, Role.leftCentralDefender, Role.leftWinger, Role.leftInnerMidfield, Role.leftForward]);
const RIGHT_ROLES = new Set<number>([Role.rightBack, Role.rightCentralDefender, Role.rightWinger, Role.rightInnerMidfield, Role.rightForward]);
const MIDDLE_ROLES = new Set<number>([Role.middleCentralDefender, Role.centralInnerMidfield, Role.centralForward]);

/** true, wenn die Position bei dieser Seiteneinschränkung NICHT beiträgt */
function isRestricted(role: number, side: Side, r: SideRestriction): boolean {
  switch (r) {
    case "none":
      return false;
    case "middleOnly":
      return !MIDDLE_ROLES.has(role);
    case "thisSide":
      if (side === "left") return !LEFT_ROLES.has(role);
      if (side === "right") return !RIGHT_ROLES.has(role);
      return !MIDDLE_ROLES.has(role);
    case "oppositeSide":
      if (side === "right") return !LEFT_ROLES.has(role);
      if (side === "left") return !RIGHT_ROLES.has(role);
      return false;
  }
}

// --- Spielerstärke ------------------------------------------------------------

/** HO: calcSkillRating – "hervorragend" (8) ohne Nachkommastellen ergibt 7,0 */
export const skillRating = (skill: number) => Math.max(0, skill - 1);

function formFactor(p: Player) {
  return 0.378 * Math.sqrt(Math.min(7, skillRating(p.form + (p.formSub ?? 0))));
}

export function loyaltyBonus(p: Player) {
  if (p.homegrown) return 1.5;
  return skillRating(p.loyalty) / 19;
}

export function strength(p: Player, skill: Skill | "setPieces"): number {
  return (skillRating(p[skill]) + loyaltyBonus(p)) * formFactor(p);
}

/** Beitrag eines Spielers auf einer Position zu einem Bewertungsbereich, ohne Erfahrung/Kondition */
export function contribution(p: Player, role: number, behaviour: BehaviourId, sector: RatingSector): number {
  const { set, side } = SECTOR_PARAMS[sector];
  const ls = lineupSector(role);
  let ret = 0;
  for (const e of CONTRIBUTIONS) {
    if (e.set !== set || e.sector !== ls || e.behaviour !== behaviour) continue;
    if (isRestricted(role, side, e.restriction)) continue;
    const v = e.specialty && e.specialty.specialty === p.specialty ? e.specialty.value : e.value;
    ret += strength(p, e.skill) * v;
  }
  return ret;
}

export function experienceContribution(sector: RatingSector, experience: number): number {
  const exp = skillRating(experience);
  const k = -0.00000725 * exp ** 4 + 0.0005 * exp ** 3 - 0.01336 * exp ** 2 + 0.176 * exp;
  switch (sector) {
    case "defenceLeft":
    case "defenceRight":
      return k * 0.345;
    case "defenceCentral":
      return k * 0.48;
    case "midfield":
      return k * 0.73;
    case "attackLeft":
    case "attackRight":
      return k * 0.375;
    case "attackCentral":
      return k * 0.45;
  }
}

/** Kondition: Faktor ≤ 1 je Spielminute (HO calcStamina) */
export function staminaFactor(stamina: number, minute: number, startMinute: number, tactic: number): number {
  const p = tactic === Tactic.pressing ? 1.1 : 1;
  const s = skillRating(stamina);
  let r0: number, delta: number;
  if (s < 7) {
    r0 = 102 + (23 / 7) * s;
    delta = p * ((27 / 70) * s - 5.95);
  } else {
    r0 = 102 + 23 + ((s - 7) * 100) / 7;
    delta = -3.25 * p;
  }
  let r = r0;
  let to = Math.min(45, minute);
  if (startMinute < to) r += ((to - startMinute) * delta) / 5;
  let from = Math.max(45, startMinute);
  if (minute >= 45) {
    if (startMinute < 45) r = Math.min(r0, r + 120.75 - 102);
    to = Math.min(90, minute);
    if (from < to) r += ((to - from) * delta) / 5;
  }
  if (minute >= 90) {
    from = Math.max(90, startMinute);
    if (startMinute < 90) r = Math.min(r0, r + 127 - 120.75);
    if (from < minute) r += ((minute - from) * delta) / 5;
  }
  return Math.min(1, r / 100);
}

const OVERCROWDING: Partial<Record<LineupSector, Record<number, number>>> = {
  centralDefence: { 2: 0.964, 3: 0.9 },
  innerMidfield: { 2: 0.935, 3: 0.825 },
  forward: { 2: 0.945, 3: 0.865 },
};

export const SCALE: Record<RatingSector, number> = {
  midfield: 0.312,
  defenceLeft: 0.834,
  defenceRight: 0.834,
  defenceCentral: 0.501,
  attackCentral: 0.513,
  attackLeft: 0.615,
  attackRight: 0.615,
};

export interface TeamState {
  teamSpirit: number;
  confidence: number;
}

function trainerFactor(sector: RatingSector, styleOfPlay: number): number {
  const f = styleOfPlay;
  if (sector.startsWith("defence")) return f <= 0 ? 1.02 - (f * (1.15 - 1.02)) / 10 : 1.02 - (f * (1.02 - 0.9)) / 10;
  if (sector.startsWith("attack")) return f <= 0 ? 1.02 - (f * (0.9 - 1.02)) / 10 : 1.02 - (f * (1.02 - 1.1)) / 10;
  return 1;
}

export function sectorFactor(sector: RatingSector, m: MatchSettings, t: TeamState): number {
  let r = 1;
  if (sector === "midfield") {
    if (m.attitude === Attitude.pic) r *= 0.83945;
    if (m.attitude === Attitude.mots) r *= 1.1149;
    if (m.location === Location.awayDerby) r *= 1.11493;
    if (m.location === Location.home) r *= 1.19892;
    if (m.tactic === Tactic.counter) r *= 0.93;
    if (m.tactic === Tactic.longShots) r *= 0.96;
    const spirit = t.teamSpirit + m.teamSpiritSubIndex * 0.25;
    r *= 0.1 + 0.425 * Math.sqrt(spirit);
  } else if (sector === "defenceLeft" || sector === "defenceRight") {
    r *= trainerFactor(sector, m.styleOfPlay);
    if (m.tactic === Tactic.attackMiddle) r *= 0.85;
    if (m.tactic === Tactic.creative) r *= 0.93;
  } else if (sector === "defenceCentral") {
    r *= trainerFactor(sector, m.styleOfPlay);
    if (m.tactic === Tactic.attackWings) r *= 0.85;
    if (m.tactic === Tactic.creative) r *= 0.93;
  } else {
    r *= trainerFactor(sector, m.styleOfPlay);
    if (m.tactic === Tactic.longShots) r *= 0.96;
    r *= 0.8 + 0.05 * (t.confidence + 0.5);
  }
  return r;
}

export interface FieldEntry {
  player: Player;
  role: RoleId;
  behaviour: BehaviourId;
}

export type SectorRatings = Record<RatingSector, number>;

/** Bewertung eines Bereichs zu einer bestimmten Spielminute */
export function sectorRating(field: FieldEntry[], sector: RatingSector, minute: number, m: MatchSettings, t: TeamState): number {
  const counts: Partial<Record<LineupSector, number>> = {};
  for (const f of field) {
    const ls = lineupSector(f.role);
    counts[ls] = (counts[ls] ?? 0) + 1;
  }
  let sum = 0;
  for (const f of field) {
    let contrib = contribution(f.player, f.role, f.behaviour, sector);
    if (contrib <= 0) continue;
    const ls = lineupSector(f.role);
    contrib *= OVERCROWDING[ls]?.[counts[ls] ?? 0] ?? 1;
    contrib += experienceContribution(sector, f.player.experience);
    contrib *= staminaFactor(f.player.stamina, minute, 0, m.tactic);
    sum += contrib;
  }
  sum *= sectorFactor(sector, m, t);
  if (sum <= 0) return 0.75;
  return (sum * SCALE[sector]) ** 1.2 / 4 + 1;
}

/** Durchschnittliche Bereichsbewertungen über 90 Minuten (wie HO "Durchschnittsrating") */
export function averageRatings(field: FieldEntry[], m: MatchSettings, t: TeamState, minutes = 90): SectorRatings {
  const out = {} as SectorRatings;
  for (const s of RATING_SECTORS) {
    let total = 0;
    for (let min = 0; min < minutes; min += 5) total += sectorRating(field, s, min, m, t) * 5;
    out[s] = total / minutes;
  }
  return out;
}

export function ratingsAtMinute(field: FieldEntry[], minute: number, m: MatchSettings, t: TeamState): SectorRatings {
  const out = {} as SectorRatings;
  for (const s of RATING_SECTORS) out[s] = sectorRating(field, s, minute, m, t);
  return out;
}

export function hatStats(r: SectorRatings): number {
  return 4 * (3 * r.midfield + r.defenceLeft + r.defenceCentral + r.defenceRight + r.attackLeft + r.attackCentral + r.attackRight);
}

/** Positionsstärke eines Einzelspielers (HO calcPlayerRating, "Sterne"-ähnlicher Wert) */
export function playerPositionRating(p: Player, role: number, behaviour: BehaviourId = Behaviour.normal): number {
  let ret = 0;
  for (const s of RATING_SECTORS) {
    let cval = contribution(p, role, behaviour, s);
    if (cval > 0) cval += experienceContribution(s, p.experience);
    cval *= SCALE[s];
    if (s === "midfield") cval *= 3;
    ret += cval;
  }
  return ret ** 1.2 / 4;
}

/** Hattrick-Bewertungsstufen für die Anzeige */
const LEVELS = [
  "katastrophal",
  "erbärmlich",
  "armselig",
  "schwach",
  "passabel",
  "durchschnittlich",
  "gut",
  "sehr gut",
  "hervorragend",
  "großartig",
  "brillant",
  "fantastisch",
  "Weltklasse",
  "übernatürlich",
  "gigantisch",
  "außerirdisch",
  "mythisch",
  "märchenhaft",
  "galaktisch",
  "göttlich",
];
const SUB = ["sehr niedrig", "niedrig", "hoch", "sehr hoch"];

export function ratingLabel(value: number): string {
  const lvl = Math.floor(value);
  const name = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, lvl - 1))];
  const sub = SUB[Math.max(0, Math.min(3, Math.floor((value - lvl) * 4)))];
  return `${name} (${sub})`;
}

export function lineupField(lineup: Lineup, players: Map<number, Player>): FieldEntry[] {
  const out: FieldEntry[] = [];
  for (const pos of lineup.positions) {
    const pl = players.get(pos.playerId);
    if (pl) out.push({ player: pl, role: pos.role, behaviour: pos.behaviour });
  }
  return out;
}
