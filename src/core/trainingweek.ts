// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Trainingswoche: A-Kader (Stammelf für die Liga), B-Kader (Trainingsgruppe) und Plan für beide Spiele der Woche.
// Liga: stärkste Elf, aber unter fast gleich starken Formationen die mit den meisten Trainingsplätzen.
// Pokal: Sieg und Training abwägen, ohne Chance reine Trainingself. Freundschaftsspiel: nur Training.

import type { FieldPosition, MatchSettings, Player } from "./model";
import type { SectorRatings, TeamState } from "./rating";
import { FORMATIONS, HATSTATS_OBJECTIVE, Evaluator, hatStatsOf, isAvailable, optimizeLineup } from "./optimizer";
import { predict, type Side } from "./matchplan";
import { type TrainingDef, type WeekMinutes, FORMATION_PREFERENCE, TRAININGS, addPlanned, formationSlots, planTrainingLineup, trainingFor, trainingPriority, weekFactor } from "./training";
import { fixed } from "./locale";

export type SquadTier = "A" | "B" | "R";
export const TIER_NAME: Record<SquadTier, string> = { A: "A-Kader", B: "B-Kader", R: "Rest" };

/** Ab so viel weniger HatStats (Anteil) als die stärkste Formation zählt Training in der Liga nicht mehr */
export const LEAGUE_TOLERANCE = 0.02;
/** Pokal: so viel Siegchance darf Training kosten */
export const CUP_MAX_WIN_DROP = 0.08;
/** Pokal: darunter ist das Spiel kaum zu gewinnen, dann reine Trainingself */
export const CUP_HOPELESS = 0.2;

const isKeeperType = (p: Player) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);

/**
 * Vorschlag für die Kader: A = Stammelf der Liga, B = bis zu 11 weitere Spieler (ein Torwart, sonst nach
 * Trainingsnutzen), Rest = alle übrigen. Eigene Zuordnungen (`own`) gehen vor.
 */
export function suggestSquads(players: Player[], leagueIds: number[], t: TrainingDef | undefined, own: Record<number, SquadTier> = {}): Map<number, SquadTier> {
  const out = new Map<number, SquadTier>();
  const a = new Set(leagueIds);
  for (const p of players) if (a.has(p.id)) out.set(p.id, "A");
  const rest = players.filter((p) => !a.has(p.id));
  const benefit = (p: Player) => (t ? trainingPriority(p, t) : 0);
  // ein Torwart für das zweite Spiel, der beste übrige
  const keeper = rest.filter(isKeeperType).sort((x, y) => y.keeper - x.keeper)[0];
  const field = rest.filter((p) => p !== keeper && !isKeeperType(p)).sort((x, y) => benefit(y) - benefit(x) || x.age - y.age);
  const b = [...(keeper ? [keeper] : []), ...field.slice(0, keeper ? 10 : 11)];
  for (const p of b) out.set(p.id, "B");
  for (const p of rest) if (!out.has(p.id)) out.set(p.id, "R");
  for (const [id, tier] of Object.entries(own)) if (out.has(Number(id))) out.set(Number(id), tier);
  return out;
}

// --- Ligaspiel ---------------------------------------------------------------------------------------

export interface FormationOption {
  formation: string;
  hatStats: number;
  experience: number;
  full: number;
  partly: number;
  positions: FieldPosition[];
}

export interface LeagueChoice {
  best: FormationOption;
  pick: FormationOption;
  options: FormationOption[];
  reason: string;
}

/**
 * Formation fürs Ligaspiel: Grundlage ist die beste Elf je Formation (nur Formationen mit genug Erfahrung).
 * Innerhalb von `tolerance` zur stärksten gewinnt die mit den meisten Trainingsplätzen, dann die stärkere.
 */
export function chooseLeagueFormation(
  perFormation: { code: string; hatStats: number; experience: number; positions: FieldPosition[] }[],
  t: TrainingDef,
  minExperience: number,
  tolerance = LEAGUE_TOLERANCE,
): LeagueChoice | null {
  const opts: FormationOption[] = perFormation
    .filter((f) => f.experience >= minExperience)
    .map((f) => {
      const s = formationSlots(t, f.code);
      const full = f.positions.filter((p) => trainingFor(p.role, t) === "voll").length;
      const partly = f.positions.filter((p) => trainingFor(p.role, t) === "teilweise").length;
      return { formation: f.code, hatStats: f.hatStats, experience: f.experience, full: f.positions.length ? full : s.full, partly: f.positions.length ? partly : s.partly, positions: f.positions };
    })
    .sort((a, b) => b.hatStats - a.hatStats);
  if (!opts.length) return null;
  const best = opts[0];
  const near = opts.filter((o) => o.hatStats >= best.hatStats * (1 - tolerance));
  const slots = (o: FormationOption) => o.full * 10 + o.partly;
  const pick = [...near].sort((a, b) => slots(b) - slots(a) || b.hatStats - a.hatStats || b.experience - a.experience)[0];
  const pct = (x: number) => `${fixed(x * 100, 1).replace(/[.,]0$/, "")} %`;
  const reason =
    pick === best
      ? `${label(best.formation)} ist die stärkste Formation und hat unter den fast gleich starken (bis ${pct(tolerance)} weniger HatStats) die meisten Trainingsplätze.`
      : `${label(pick.formation)} kostet nur ${(best.hatStats - pick.hatStats).toFixed(0)} HatStats (−${pct(1 - pick.hatStats / best.hatStats)}) gegenüber ${label(best.formation)}, bringt aber ${slotText(pick)} statt ${slotText(best)}. Regel: höchstens ${pct(tolerance)} HatStats für Training abgeben.`;
  return { best, pick, options: opts, reason };
}

const label = (f: string) => f.split("").join("-");
export const slotText = (o: { full: number; partly: number }) => `${o.full} Trainingsplätze${o.partly ? ` + ${o.partly} halbe` : ""}`;

// --- Zweites Spiel ------------------------------------------------------------------------------------

export interface CupVariant {
  key: "strong" | "mixed" | "training";
  label: string;
  formation: string;
  positions: FieldPosition[];
  hatStats: number;
  /** Siegchance, null ohne Gegnerdaten */
  win: number | null;
  /** Spieler, die durch dieses Spiel diese Woche Training dazubekommen */
  newTrainees: number;
}

export interface CupPlan {
  variants: CupVariant[];
  recommended: CupVariant["key"];
  reason: string;
}

function gainCount(positions: FieldPosition[], before: Map<number, WeekMinutes>, t: TrainingDef): number {
  const after = addPlanned(before, positions, t, "x");
  return positions.filter((p) => weekFactor(after.get(p.playerId)) > weekFactor(before.get(p.playerId)) + 1e-9).length;
}

/**
 * Pokal: drei Varianten. Stärkste Elf, „Sieg + Training“ (stärkste Elf ohne die schon voll trainierten Spieler,
 * in der Formation mit den meisten neuen Trainingsplätzen, solange die Siegchance höchstens `maxDrop` sinkt)
 * und reine Trainingself. Ist die Siegchance schon mit der stärksten Elf unter `hopeless`, gewinnt Training.
 * Ohne Gegnerdaten wird statt der Siegchance die Stärke (HatStats, höchstens 5 % weniger) verglichen.
 */
export function planCup(
  players: Player[],
  trainingType: number,
  before: Map<number, WeekMinutes>,
  settings: MatchSettings,
  team: TeamState,
  opt: { formationExperience: Record<string, number>; minExperience: number; allowBruised: boolean; opponent: Side | null; maxDrop?: number; hopeless?: number },
): CupPlan {
  const t = TRAININGS[trainingType];
  const maxDrop = opt.maxDrop ?? CUP_MAX_WIN_DROP;
  const hopeless = opt.hopeless ?? CUP_HOPELESS;
  const byId = new Map(players.map((p) => [p.id, p]));
  const ev = new Evaluator(settings, team);
  const rate = (positions: FieldPosition[]): { hatStats: number; win: number | null } => {
    const field = positions.map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour })).filter((x) => x.player);
    const ratings: SectorRatings = ev.ratings(field);
    const win = opt.opponent ? predict({ ratings, tactic: settings.tactic, level: null }, opt.opponent, 1500).win : null;
    return { hatStats: hatStatsOf(ratings), win };
  };
  const formations = FORMATIONS.filter((f) => (opt.formationExperience[f] ?? 0) >= opt.minExperience);
  const base = { formationExperience: opt.formationExperience, objective: HATSTATS_OBJECTIVE, allowBruised: opt.allowBruised, tryBehaviours: false, minFormationExperience: 0 };

  const strongRes = optimizeLineup(players, settings, team, { ...base, formations: formations.length ? formations : ["442"] });
  const strong: CupVariant = { key: "strong", label: "Stärkste Elf", formation: strongRes.lineup.formation, positions: strongRes.lineup.positions, ...rate(strongRes.lineup.positions), newTrainees: gainCount(strongRes.lineup.positions, before, t) };

  // Sieg + Training: von der besten Elf je Formation ausgehen und Trainingsplätze, auf denen schon voll
  // trainierte Spieler stehen, nacheinander an noch nicht trainierte geben (die billigsten Tausche zuerst),
  // solange die Siegchance (ohne Gegnerdaten: die Stärke) hoch genug bleibt.
  const done = new Set([...before].filter(([, m]) => weekFactor(m) >= 1).map(([id]) => id));
  const floor = strong.win !== null ? strong.win - maxDrop : strong.hatStats * 0.95;
  const score = (x: { win: number | null; hatStats: number }) => x.win ?? x.hatStats;
  let mixed = null as CupVariant | null;
  for (const f of formations.length ? formations : ["442"]) {
    let r;
    try {
      r = f === strong.formation ? strongRes : optimizeLineup(players, settings, team, { ...base, formations: [f] });
    } catch {
      continue;
    }
    let positions = r.lineup.positions.map((p) => ({ ...p }));
    const take = (cand: CupVariant | null) => {
      if (!cand || score(cand) < floor) return;
      if (!mixed || cand.newTrainees > mixed.newTrainees || (cand.newTrainees === mixed.newTrainees && score(cand) > score(mixed))) mixed = cand;
    };
    const evalPos = (pos: FieldPosition[]): CupVariant => ({ key: "mixed", label: "Sieg + Training", formation: f, positions: pos, ...rate(pos), newTrainees: gainCount(pos, before, t) });
    take(evalPos(positions));
    for (;;) {
      const inLineup = new Set(positions.map((p) => p.playerId));
      const fresh = players.filter((p) => isAvailable(p, opt.allowBruised) && !inLineup.has(p.id) && !done.has(p.id) && (t.skill === "keeper" || !isKeeperType(p)));
      let bestSwap: { pos: FieldPosition[]; v: CupVariant } | null = null;
      for (const slot of positions) {
        if (trainingFor(slot.role, t) === "keins" || !done.has(slot.playerId)) continue;
        for (const p of fresh) {
          const pos = positions.map((x) => (x === slot ? { ...x, playerId: p.id } : x));
          const v = evalPos(pos);
          if (!bestSwap || score(v) > score(bestSwap.v)) bestSwap = { pos, v };
        }
      }
      if (!bestSwap || score(bestSwap.v) < floor) break;
      positions = bestSwap.pos;
      take(bestSwap.v);
    }
  }

  const trainPlan = planTrainingLineup(players, trainingType, before, opt.allowBruised, opt.formationExperience);
  const training: CupVariant = { key: "training", label: "Reine Trainingself", formation: trainPlan.lineup.formation, positions: trainPlan.lineup.positions, ...rate(trainPlan.lineup.positions), newTrainees: trainPlan.gaining.length };

  const variants = [strong, ...(mixed && mixed.newTrainees > strong.newTrainees ? [mixed] : []), training];
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  let recommended: CupVariant["key"];
  let reason: string;
  if (strong.win !== null && strong.win < hopeless) {
    recommended = "training";
    reason = `Selbst mit der stärksten Elf nur ${pct(strong.win)} Siegchance. Dann lieber reine Trainingself: ${training.newTrainees} Spieler bekommen Training.`;
  } else if (mixed && mixed.newTrainees > strong.newTrainees) {
    recommended = "mixed";
    reason =
      strong.win !== null && mixed.win !== null
        ? `${label(mixed.formation)}, Trainingsplätze für noch nicht trainierte Spieler: Siegchance ${pct(strong.win)} → ${pct(mixed.win)}, dafür ${mixed.newTrainees} statt ${strong.newTrainees} Spieler mit Training. Erlaubt sind bis ${Math.round(maxDrop * 100)} Punkte weniger Siegchance.`
        : `${label(mixed.formation)}, Trainingsplätze für noch nicht trainierte Spieler: ${mixed.hatStats.toFixed(0)} statt ${strong.hatStats.toFixed(0)} HatStats, dafür ${mixed.newTrainees} statt ${strong.newTrainees} Spieler mit Training. Ohne Gegnerdaten zählt die Stärke (höchstens 5 % weniger).`;
  } else {
    recommended = "strong";
    reason = `Jede Variante mit mehr Training kostet zu viel ${strong.win !== null ? "Siegchance" : "Stärke"}. Stärkste Elf aufstellen; ${strong.newTrainees} Spieler bekommen dabei Training.`;
  }
  return { variants, recommended, reason };
}

// --- Wochenübersicht ----------------------------------------------------------------------------------

export interface WeekRow {
  player: Player;
  tier: SquadTier;
  benefit: number;
  /** Position im Ligaspiel und im 2. Spiel (Rollen-ID), 0 = spielt nicht */
  leagueRole: number;
  secondRole: number;
  /** Trainingswirkung nach beiden Spielen, 0..1 */
  factor: number;
  /** schon in dieser Woche gespielt (laut HRF) */
  playedSources: string[];
}

export function weekRows(
  players: Player[],
  tiers: Map<number, SquadTier>,
  t: TrainingDef,
  played: Map<number, WeekMinutes>,
  league: FieldPosition[],
  second: FieldPosition[],
): WeekRow[] {
  const after = addPlanned(addPlanned(played, league, t, "Liga"), second, t, "2. Spiel");
  return players
    .map((p) => ({
      player: p,
      tier: tiers.get(p.id) ?? "R",
      benefit: trainingPriority(p, t),
      leagueRole: league.find((x) => x.playerId === p.id)?.role ?? 0,
      secondRole: second.find((x) => x.playerId === p.id)?.role ?? 0,
      factor: weekFactor(after.get(p.id)),
      playedSources: played.get(p.id)?.sources ?? [],
    }))
    .sort((a, b) => b.benefit - a.benefit);
}

/** Spieler mit spürbarem Trainingsnutzen, die diese Woche leer ausgehen (ohne Torhüter bei Feldtraining) */
export function forgotten(rows: WeekRow[], t: TrainingDef, minBenefit = 3): WeekRow[] {
  return rows.filter((r) => r.factor === 0 && r.benefit >= minBenefit && (t.skill === "keeper" || !isKeeperType(r.player)));
}

export { FORMATION_PREFERENCE };
