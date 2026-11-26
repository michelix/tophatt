// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Aufstellung gegen einen bestimmten Gegner: Formation, Taktik und Spieler nach den meisten erwarteten Punkten
// statt nach den höchsten HatStats. Spieler kommen dorthin, wo der Gegner schwach ist (Gewichte aus der
// Spielvorhersage), bewertet wird jede Elf mit allen Taktiken und Ausrichtungen (planMatch).

import type { FieldPosition, MatchSettings, Player } from "./model";
import { RATING_SECTORS, type RatingSector, type SectorRatings, type TeamState } from "./rating";
import { FORMATIONS, HATSTATS_OBJECTIVE, type Objective, optimizeLineup } from "./optimizer";
import { type MatchPlan, type Side, effectiveness, planMatch } from "./matchplan";
import { type TrainingDef, trainingFor } from "./training";

/** HO rechnet mit Hattrick-Zahlen (1 … 80), TopHatt mit Stufen */
const ht = (level: number) => Math.max(1, 4 * level - 3);
const ratio = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0.5);
/** Anteil der Angriffe links, Mitte, rechts bei normaler Taktik (HO: 40 % Mitte) */
const SHARE = [0.3, 0.4, 0.3] as const;

/** glatte Näherung der Spielvorhersage: erwartete Tordifferenz aus 10 Angriffen */
export function expectedGoalDiff(us: SectorRatings, them: SectorRatings): number {
  const u = (k: RatingSector) => ht(us[k]);
  const t = (k: RatingSector) => ht(them[k]);
  const poss = effectiveness(ratio(u("midfield"), t("midfield"))) / 100;
  const ours = [ratio(u("attackLeft"), t("defenceRight")), ratio(u("attackCentral"), t("defenceCentral")), ratio(u("attackRight"), t("defenceLeft"))];
  const theirs = [ratio(t("attackLeft"), u("defenceRight")), ratio(t("attackCentral"), u("defenceCentral")), ratio(t("attackRight"), u("defenceLeft"))];
  const goals = (c: number[]) => c.reduce((a, x, i) => a + SHARE[i] * (effectiveness(x) / 100), 0);
  return 10 * (poss * goals(ours) - (1 - poss) * goals(theirs));
}

/**
 * Gewichte für den Optimierer gegen diesen Gegner: wie viel eine Stufe mehr im jeweiligen Bereich an erwarteter
 * Tordifferenz bringt, ausgehend von unseren Bewertungen. Skaliert auf dieselbe Summe wie HatStats (9).
 */
export function opponentObjective(us: SectorRatings, them: SectorRatings): Objective {
  const base = expectedGoalDiff(us, them);
  const grad = {} as Record<RatingSector, number>;
  for (const k of RATING_SECTORS) grad[k] = Math.max(0, (expectedGoalDiff({ ...us, [k]: us[k] + 0.25 }, them) - base) / 0.25);
  const sum = RATING_SECTORS.reduce((a, k) => a + grad[k], 0);
  const total = RATING_SECTORS.reduce((a, k) => a + HATSTATS_OBJECTIVE.weights[k], 0);
  const weights = {} as Record<RatingSector, number>;
  for (const k of RATING_SECTORS) weights[k] = sum > 0 ? (grad[k] / sum) * total : HATSTATS_OBJECTIVE.weights[k];
  return { weights };
}

/** halb HatStats, halb gegnerbezogen: verschiebt Spieler, ohne die Elf ganz umzubauen */
const blend = (a: Objective, b: Objective, w: number): Objective => {
  const weights = {} as Record<RatingSector, number>;
  for (const k of RATING_SECTORS) weights[k] = (1 - w) * a.weights[k] + w * b.weights[k];
  return { weights };
};

export interface FitCandidate {
  formation: string;
  positions: FieldPosition[];
  plan: MatchPlan;
  experience: number;
  /** volle und halbe Trainingsplätze, auf denen jemand steht */
  full: number;
  partly: number;
  /** aus der HatStats-Elf (false) oder aus der Elf mit Gegnergewichten (true) */
  shifted: boolean;
}

export interface FitResult {
  pick: FitCandidate;
  /** alle bewerteten Elfen, beste zuerst */
  candidates: FitCandidate[];
  /** Trainingsplätze haben bei fast gleichen Punkten den Ausschlag gegeben */
  byTraining: boolean;
}

export interface FitOptions {
  formationExperience: Record<string, number>;
  minExperience: number;
  allowBruised: boolean;
  styleRange: [number, number];
  cup?: boolean;
  training?: TrainingDef;
  /** nur diese Formationen (sonst alle ab der Mindesterfahrung) */
  formations?: string[];
}

/** So viele erwartete Punkte darf die Elf mit mehr Trainingsplätzen kosten */
export const TRAINING_POINTS_TOLERANCE = 0.03;

const sameLineup = (a: FieldPosition[], b: FieldPosition[]) =>
  a.length === b.length && a.every((p) => b.some((q) => q.playerId === p.playerId && q.role === p.role && q.behaviour === p.behaviour));

/**
 * Beste Elf gegen diesen Gegner. Je Formation (ab der Mindesterfahrung) drei Elfen: die stärkste nach HatStats und
 * zwei mit Gegnergewichten (halb und ganz). Jede wird mit allen Taktiken und Ausrichtungen gegen den Gegner
 * gerechnet; gewählt wird die mit den meisten erwarteten Punkten. Liegen Elfen mit mehr Trainingsplätzen höchstens
 * TRAINING_POINTS_TOLERANCE dahinter, gewinnt die mit den meisten Trainingsplätzen.
 */
export function fitLineup(players: Player[], settings: MatchSettings, team: TeamState, opponent: Side, opt: FitOptions): FitResult | null {
  const byId = new Map(players.map((p) => [p.id, p]));
  let codes = (opt.formations ?? [...FORMATIONS]).filter((f) => (opt.formationExperience[f] ?? 0) >= opt.minExperience);
  if (!codes.length && !opt.formations) codes = ["442"];
  const candidates: FitCandidate[] = [];
  const run = (f: string, objective: Objective) =>
    optimizeLineup(players, settings, team, {
      minFormationExperience: 0,
      formationExperience: opt.formationExperience,
      objective,
      allowBruised: opt.allowBruised,
      tryBehaviours: false,
      formations: [f],
    });
  for (const f of codes) {
    let base;
    try {
      base = run(f, HATSTATS_OBJECTIVE);
    } catch {
      continue; // zu wenige Spieler für diese Formation
    }
    const target = opponentObjective(base.ratings, opponent.ratings);
    const lineups = [base.lineup.positions];
    for (const w of [0.5, 1]) {
      const r = run(f, blend(HATSTATS_OBJECTIVE, target, w));
      if (!lineups.some((l) => sameLineup(l, r.lineup.positions))) lineups.push(r.lineup.positions);
    }
    lineups.forEach((positions, i) => {
      const plan = planMatch(positions, byId, settings, team, opponent, { cup: opt.cup, styleRange: opt.styleRange });
      const slot = (lvl: string) => (opt.training ? positions.filter((p) => trainingFor(p.role, opt.training!) === lvl).length : 0);
      candidates.push({ formation: f, positions, plan, experience: opt.formationExperience[f] ?? 0, full: slot("voll"), partly: slot("teilweise"), shifted: i > 0 });
    });
  }
  if (!candidates.length) return null;
  const pts = (c: FitCandidate) => c.plan.best.prediction.points;
  candidates.sort((a, b) => pts(b) - pts(a) || b.plan.best.hatStats - a.plan.best.hatStats);
  const top = candidates[0];
  const slots = (c: FitCandidate) => c.full * 10 + c.partly;
  const near = candidates.filter((c) => pts(c) >= pts(top) - TRAINING_POINTS_TOLERANCE);
  const pick = opt.training ? [...near].sort((a, b) => slots(b) - slots(a) || pts(b) - pts(a))[0] : top;
  return { pick, candidates, byTraining: pick !== top && slots(pick) > slots(top) };
}
