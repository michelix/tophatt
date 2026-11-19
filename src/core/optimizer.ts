// Aufstellungs-Optimierer: sucht für jede erlaubte Formation die Spieler-/Positions-/Verhaltens-
// Kombination mit der höchsten Zielbewertung (Standard: HatStats, 90-Minuten-Durchschnitt).
// Vorgehen: gierige Startaufstellung, dann lokale Suche (Tauschen, Einwechseln, Verhalten ändern).

import type { BehaviourId, BenchSlot, FieldPosition, Lineup, MatchSettings, Player, RoleId } from "./model";
import { Behaviour, Role } from "./model";
import {
  RATING_SECTORS,
  type RatingSector,
  type SectorRatings,
  type TeamState,
  contribution,
  experienceContribution,
  lineupSector,
  playerPositionRating,
  staminaFactor,
  strength,
  sectorFactor,
  SCALE,
} from "./rating";

// --- Formationen ------------------------------------------------------------

const DEF: Record<number, RoleId[][]> = {
  2: [[Role.rightCentralDefender, Role.leftCentralDefender]],
  3: [
    [Role.rightCentralDefender, Role.middleCentralDefender, Role.leftCentralDefender],
    [Role.rightBack, Role.middleCentralDefender, Role.leftBack],
  ],
  4: [[Role.rightBack, Role.rightCentralDefender, Role.leftCentralDefender, Role.leftBack]],
  5: [[Role.rightBack, Role.rightCentralDefender, Role.middleCentralDefender, Role.leftCentralDefender, Role.leftBack]],
};
const MID: Record<number, RoleId[][]> = {
  2: [[Role.rightInnerMidfield, Role.leftInnerMidfield]],
  3: [
    [Role.rightInnerMidfield, Role.centralInnerMidfield, Role.leftInnerMidfield],
    [Role.rightWinger, Role.centralInnerMidfield, Role.leftWinger],
  ],
  4: [[Role.rightWinger, Role.rightInnerMidfield, Role.leftInnerMidfield, Role.leftWinger]],
  5: [[Role.rightWinger, Role.rightInnerMidfield, Role.centralInnerMidfield, Role.leftInnerMidfield, Role.leftWinger]],
};
const FWD: Record<number, RoleId[]> = {
  0: [],
  1: [Role.centralForward],
  2: [Role.rightForward, Role.leftForward],
  3: [Role.rightForward, Role.centralForward, Role.leftForward],
};

export const FORMATIONS = ["550", "541", "532", "523", "451", "442", "433", "352", "343", "253"] as const;

export function formationVariants(code: string): RoleId[][] {
  const d = Number(code[0]),
    m = Number(code[1]),
    f = Number(code[2]);
  const out: RoleId[][] = [];
  for (const dv of DEF[d] ?? []) for (const mv of MID[m] ?? []) out.push([Role.keeper, ...dv, ...mv, ...FWD[f]]);
  return out;
}

export function formationLabel(code: string) {
  return `${code[0]}-${code[1]}-${code[2]}`;
}

/** Erlaubte Verhaltensweisen je Position (wie in Hattrick) */
export function behavioursFor(role: number): BehaviourId[] {
  const { normal: N, offensive: O, defensive: D, towardsMiddle: TM, towardsWing: TW } = Behaviour;
  switch (lineupSector(role)) {
    case "goal":
      return [N];
    case "back":
      return [N, O, D, TM];
    case "centralDefence":
      return role === Role.middleCentralDefender ? [N, O] : [N, O, TW];
    case "wing":
      return [N, O, D, TM];
    case "innerMidfield":
      return role === Role.centralInnerMidfield ? [N, O, D] : [N, O, D, TW];
    case "forward":
      return role === Role.centralForward ? [N, D] : [N, D, TW];
  }
}

// --- Zielfunktion ----------------------------------------------------------------

export interface Objective {
  /** Gewichte je Bereich; HatStats = Mittelfeld 3, alle anderen 1 */
  weights: Record<RatingSector, number>;
}

export const HATSTATS_OBJECTIVE: Objective = {
  weights: {
    midfield: 3,
    defenceLeft: 1,
    defenceCentral: 1,
    defenceRight: 1,
    attackLeft: 1,
    attackCentral: 1,
    attackRight: 1,
  },
};

/** Schneller Bewerter mit Zwischenspeicher für Spielerbeiträge */
export class Evaluator {
  private cache = new Map<string, number>();
  private staminaCache = new Map<string, number>();
  readonly minutes: number[];
  constructor(
    readonly settings: MatchSettings,
    readonly team: TeamState,
    minutes = 90,
  ) {
    this.minutes = [];
    for (let m = 0; m < minutes; m += 5) this.minutes.push(m);
  }

  private contrib(p: Player, role: number, b: BehaviourId, s: RatingSector) {
    const key = `${p.id}:${role}:${b}:${s}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      v = contribution(p, role, b, s);
      this.cache.set(key, v);
    }
    return v;
  }

  private stamina(stamina: number, minute: number) {
    const key = `${stamina}:${minute}`;
    let v = this.staminaCache.get(key);
    if (v === undefined) {
      v = staminaFactor(stamina, minute, 0, this.settings.tactic);
      this.staminaCache.set(key, v);
    }
    return v;
  }

  ratings(field: { player: Player; role: number; behaviour: BehaviourId }[]): SectorRatings {
    // Eine kleine Kopie der Logik aus rating.ts, aber mit Cache – Ergebnis identisch zu averageRatings()
    const counts: Record<string, number> = {};
    for (const f of field) {
      const ls = lineupSector(f.role);
      counts[ls] = (counts[ls] ?? 0) + 1;
    }
    const over = (ls: string) => {
      const n = counts[ls] ?? 0;
      if (ls === "centralDefence") return n === 2 ? 0.964 : n === 3 ? 0.9 : 1;
      if (ls === "innerMidfield") return n === 2 ? 0.935 : n === 3 ? 0.825 : 1;
      if (ls === "forward") return n === 2 ? 0.945 : n === 3 ? 0.865 : 1;
      return 1;
    };
    const out = {} as SectorRatings;
    for (const s of RATING_SECTORS) {
      const base: { v: number; stamina: number }[] = [];
      for (const f of field) {
        const cval = this.contrib(f.player, f.role, f.behaviour, s);
        if (cval <= 0) continue;
        base.push({ v: cval * over(lineupSector(f.role)) + experienceContribution(s, f.player.experience), stamina: f.player.stamina });
      }
      const factor = sectorFactor(s, this.settings, this.team);
      let total = 0;
      for (const m of this.minutes) {
        let sum = 0;
        for (const b of base) sum += b.v * this.stamina(b.stamina, m);
        sum *= factor;
        total += sum <= 0 ? 0.75 : (sum * SCALE[s]) ** 1.2 / 4 + 1;
      }
      out[s] = total / this.minutes.length;
    }
    return out;
  }

  score(r: SectorRatings, obj: Objective) {
    let v = 0;
    for (const s of RATING_SECTORS) v += r[s] * obj.weights[s];
    return v;
  }
}

// --- Optimierung -------------------------------------------------------------

export interface OptimizeOptions {
  /** Mindest-Formationserfahrung (Hattrick-Stufe), darunter droht Desorganisation */
  minFormationExperience: number;
  formationExperience: Record<string, number>;
  objective: Objective;
  /** Spieler, die nicht aufgestellt werden dürfen */
  excluded?: Set<number>;
  /** Angeschlagene (Pflaster) erlauben */
  allowBruised: boolean;
  /** Nur diese Formationen prüfen (optional) */
  formations?: string[];
  /** Verhaltensänderungen ausprobieren */
  tryBehaviours: boolean;
}

export interface OptimizeResult {
  lineup: Lineup;
  ratings: SectorRatings;
  hatStats: number;
  score: number;
  /** Ergebnisse je Formation zum Vergleich */
  perFormation: { formation: string; hatStats: number; score: number; experience: number }[];
}

export function isAvailable(p: Player, allowBruised: boolean) {
  if (p.injury > 0) return false;
  if (p.injury === 0 && !allowBruised) return false;
  if (p.cards >= 3) return false;
  return true;
}

interface Slot {
  role: RoleId;
  player: Player;
  behaviour: BehaviourId;
}

function optimizeVariant(roles: RoleId[], pool: Player[], ev: Evaluator, opt: OptimizeOptions): { slots: Slot[]; score: number; ratings: SectorRatings } {
  // 1) Gierig: Positionen nach "Seltenheit" füllen (Torwart zuerst, dann Mittelfeld)
  const order = [...roles].sort((a, b) => prio(a) - prio(b));
  const used = new Set<number>();
  const slots: Slot[] = [];
  for (const role of order) {
    let best: Player | null = null;
    let bestV = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const v = playerPositionRating(p, role);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (!best) break;
    used.add(best.id);
    slots.push({ role, player: best, behaviour: Behaviour.normal });
  }

  const evalSlots = (s: Slot[]) => {
    const r = ev.ratings(s);
    return { r, v: ev.score(r, opt.objective) };
  };
  let cur = evalSlots(slots);

  // 2) Lokale Suche
  let improved = true;
  let rounds = 0;
  while (improved && rounds < 30) {
    improved = false;
    rounds++;
    // a) zwei Feldspieler tauschen
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i].player;
        slots[i].player = slots[j].player;
        slots[j].player = a;
        const n = evalSlots(slots);
        if (n.v > cur.v + 1e-9) {
          cur = n;
          improved = true;
        } else {
          slots[j].player = slots[i].player;
          slots[i].player = a;
        }
      }
    }
    // b) Ersatzspieler einwechseln
    for (let i = 0; i < slots.length; i++) {
      for (const p of pool) {
        if (used.has(p.id)) continue;
        const old = slots[i].player;
        slots[i].player = p;
        const n = evalSlots(slots);
        if (n.v > cur.v + 1e-9) {
          used.delete(old.id);
          used.add(p.id);
          cur = n;
          improved = true;
        } else {
          slots[i].player = old;
        }
      }
    }
    // c) Verhalten ändern
    if (opt.tryBehaviours) {
      for (const s of slots) {
        for (const b of behavioursFor(s.role)) {
          if (b === s.behaviour) continue;
          const old = s.behaviour;
          s.behaviour = b;
          const n = evalSlots(slots);
          if (n.v > cur.v + 1e-9) {
            cur = n;
            improved = true;
          } else s.behaviour = old;
        }
      }
    }
  }
  return { slots, score: cur.v, ratings: cur.r };
}

function prio(role: number) {
  switch (lineupSector(role)) {
    case "goal":
      return 0;
    case "innerMidfield":
      return 1;
    case "centralDefence":
      return 2;
    case "forward":
      return 3;
    case "back":
      return 4;
    case "wing":
      return 5;
  }
}

export function optimizeLineup(players: Player[], settings: MatchSettings, team: TeamState, opt: OptimizeOptions): OptimizeResult {
  const pool = players.filter((p) => isAvailable(p, opt.allowBruised) && !opt.excluded?.has(p.id));
  const ev = new Evaluator(settings, team);
  const perFormation: OptimizeResult["perFormation"] = [];
  let best: { slots: Slot[]; score: number; ratings: SectorRatings; formation: string } | null = null;

  const formations = (opt.formations ?? [...FORMATIONS]).filter((f) => (opt.formationExperience[f] ?? 0) >= opt.minFormationExperience);
  if (formations.length === 0) formations.push("442");

  for (const f of formations) {
    let bestF: { slots: Slot[]; score: number; ratings: SectorRatings } | null = null;
    for (const roles of formationVariants(f)) {
      if (pool.length < roles.length) continue;
      const res = optimizeVariant(roles, pool, ev, opt);
      if (!bestF || res.score > bestF.score) bestF = res;
    }
    if (!bestF) continue;
    perFormation.push({ formation: f, hatStats: hatStatsOf(bestF.ratings), score: bestF.score, experience: opt.formationExperience[f] ?? 0 });
    if (!best || bestF.score > best.score) best = { ...bestF, formation: f };
  }
  if (!best) throw new Error("Zu wenige einsatzfähige Spieler für eine Aufstellung.");

  const field = best.slots;
  const fieldIds = new Set(field.map((s) => s.player.id));
  const rest = pool.filter((p) => !fieldIds.has(p.id));
  const bench = pickBench(rest);
  const lineup: Lineup = {
    formation: best.formation,
    positions: field
      .map<FieldPosition>((s) => ({ role: s.role, playerId: s.player.id, behaviour: s.behaviour }))
      .sort((a, b) => a.role - b.role),
    bench,
    captainId: pickCaptain(field.map((s) => s.player)),
    setPiecesId: pickSetPieces(field.filter((s) => s.role !== Role.keeper).map((s) => s.player)),
    tactic: settings.tactic,
    attitude: settings.attitude,
    styleOfPlay: settings.styleOfPlay,
  };
  perFormation.sort((a, b) => b.score - a.score);
  return { lineup, ratings: best.ratings, hatStats: hatStatsOf(best.ratings), score: best.score, perFormation };
}

export function hatStatsOf(r: SectorRatings) {
  return 4 * (3 * r.midfield + r.defenceLeft + r.defenceCentral + r.defenceRight + r.attackLeft + r.attackCentral + r.attackRight);
}

const BENCH_ROLES: [BenchSlot, number][] = [
  ["keeper", Role.keeper],
  ["centralDefender", Role.leftCentralDefender],
  ["wingBack", Role.leftBack],
  ["innerMidfield", Role.leftInnerMidfield],
  ["forward", Role.centralForward],
  ["winger", Role.leftWinger],
];

/**
 * Ersatzbank aus den übrigen Spielern. `fixed` sind vom Nutzer gewählte Plätze: eine Spieler-ID
 * bleibt stehen, 0 lässt den Platz leer; alle anderen Plätze werden automatisch besetzt.
 */
export function pickBench(rest: Player[], fixed: Partial<Record<BenchSlot, number>> = {}): Lineup["bench"] {
  const bench: Lineup["bench"] = {};
  const used = new Set<number>();
  for (const [slot, id] of Object.entries(fixed) as [BenchSlot, number][]) {
    if (id && rest.some((p) => p.id === id) && !used.has(id)) {
      bench[slot] = id;
      used.add(id);
    }
  }
  const isFixed = (slot: BenchSlot) => slot in fixed && (fixed[slot] === 0 || bench[slot] !== undefined);
  for (const [slot, role] of BENCH_ROLES) {
    if (isFixed(slot)) continue;
    let best: Player | null = null;
    let bestV = -1;
    for (const p of rest) {
      if (used.has(p.id)) continue;
      const v = playerPositionRating(p, role);
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (best) {
      bench[slot] = best.id;
      used.add(best.id);
    }
  }
  // Joker: bester verbleibender Feldspieler
  let joker: Player | null = null;
  let jv = -1;
  for (const p of rest) {
    if (used.has(p.id)) continue;
    const v = Math.max(...[Role.leftCentralDefender, Role.leftBack, Role.leftInnerMidfield, Role.leftWinger, Role.centralForward].map((r) => playerPositionRating(p, r)));
    if (v > jv) {
      jv = v;
      joker = p;
    }
  }
  if (joker && !isFixed("extra")) bench.extra = joker.id;
  return bench;
}

/** HO: Lineup.getAverageExperience – Kapitän maximiert (ØErfahrung) * Führungsfaktor */
export function pickCaptain(field: Player[]): number {
  const sumExp = field.reduce((a, p) => a + p.experience, 0);
  let best = 0,
    bestV = -Infinity;
  for (const p of field) {
    const v = ((sumExp + p.experience) / 12) * (1 - (7 - p.leadership) * 0.05);
    if (v > bestV) {
      bestV = v;
      best = p.id;
    }
  }
  return best;
}

/** HO: getPlayerSetPiecesStrength (ohne Wetter/Kondition) */
export function setPiecesStrength(p: Player) {
  const loyalty = p.homegrown ? 1.5 : Math.max(0, p.loyalty - 1) / 19;
  const xp = Math.max(0, p.experience - 1);
  return loyalty + strength(p, "setPieces") + (xp > 0 ? (Math.log10(xp) * 4) / 3 : 0);
}

export function pickSetPieces(field: Player[]): number {
  let best = 0,
    bestV = -Infinity;
  for (const p of field) {
    const v = setPiecesStrength(p);
    if (v > bestV || (v === bestV && p.form > (field.find((x) => x.id === best)?.form ?? 0))) {
      bestV = v;
      best = p.id;
    }
  }
  return best;
}
