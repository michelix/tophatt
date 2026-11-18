// Spielvorhersage und Empfehlung für Taktik, Einstellung und Ausrichtung.
// Das Spielmodell ist aus HO portiert (core/prediction/engine: ActionGenerator.simulate, BaseActionGenerator,
// CounterAttackGenerator): 10 Angriffe pro Spiel, Ballbesitz aus dem Mittelfeld, Torchance aus Angriff gegen Abwehr.

import { Attitude, type FieldPosition, type MatchSettings, type Player, Tactic } from "./model";
import type { SectorRatings, TeamState } from "./rating";
import { Evaluator, hatStatsOf } from "./optimizer";
import { tacticLevel, TACTIC_NAME, ATTITUDE_NAME } from "./tactics";

export interface Side {
  ratings: SectorRatings;
  tactic: number;
  /** Taktikstärke (HO-Skala), null = unbekannt */
  level: number | null;
}

export interface Prediction {
  win: number;
  draw: number;
  loss: number;
  goalsFor: number;
  goalsAgainst: number;
  /** erwartete Punkte (3 Sieg, 1 Remis) */
  points: number;
}

/** HO BaseActionGenerator.getEffectiveness: Anteil 0..1 → Erfolgsquote in Prozent */
export function effectiveness(value: number): number {
  let x = value * 100;
  let low = false;
  if (x < 50) {
    low = true;
    x = 100 - x;
  }
  const v = -500000 / x ** 2 + 10000 / x + 50;
  return low ? 100 - v : v;
}

/** kleiner, reproduzierbarer Zufallsgenerator, damit gleiche Eingaben gleiche Ergebnisse liefern */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const ratio = (a: number, b: number) => (a + b > 0 ? a / (a + b) : 0.5);

interface Game {
  poss: number;
  /** Anteil links, Mitte, rechts */
  chance: [number, number, number];
  tactic: number;
  level: number;
  counters: number;
}

function game(t: Side, o: Side): Omit<Game, "counters"> {
  return {
    poss: ratio(t.ratings.midfield, o.ratings.midfield),
    chance: [ratio(t.ratings.attackLeft, o.ratings.defenceRight), ratio(t.ratings.attackCentral, o.ratings.defenceCentral), ratio(t.ratings.attackRight, o.ratings.defenceLeft)],
    tactic: t.tactic,
    level: t.level ?? 0,
  };
}

/** HO CounterAttackGenerator.getCounterAction ohne Zufallsrundung: erwartete Zahl der Konter */
function counterActions(t: Side, o: Side): number {
  if (t.tactic !== Tactic.counter) return 0;
  const ability = t.level ?? 0;
  const def = o.ratings.defenceLeft + o.ratings.defenceCentral + o.ratings.defenceRight;
  const idx = (ability / (def / 6 + ability)) * 100;
  return Math.min(3, 4.00008896306671 / (1 + 58995.2231780103 * Math.exp(-0.21970325236894 * idx)));
}

function area(g: Game, r: () => number): 0 | 1 | 2 {
  let middle = 40;
  if (g.tactic === Tactic.attackMiddle) middle += g.level * 3;
  if (g.tactic === Tactic.attackWings) middle = Math.trunc(middle - g.level * 1.5);
  const a = Math.floor(r() * 100);
  if (a < middle) return 1;
  return a < (100 - middle) / 2 + middle ? 0 : 2;
}

const scores = (g: Game, where: 0 | 1 | 2, r: () => number) => Math.floor(r() * 100) < Math.trunc(effectiveness(g.chance[where]));

/**
 * Spiel n-mal simulieren (HO ActionGenerator.simulate). Pressing ist nicht enthalten, weil TopHatt die
 * Pressing-Stärke nicht berechnet.
 */
export function predict(us: Side, them: Side, n = 3000, seed = 7): Prediction {
  const r = rng(seed);
  const a = game(us, them);
  const b = game(them, us);
  const caUs = counterActions(us, them);
  const caThem = counterActions(them, us);
  const possUs = Math.trunc(effectiveness(a.poss));
  let win = 0,
    draw = 0,
    gf = 0,
    ga = 0;
  for (let i = 0; i < n; i++) {
    const A: Game = { ...a, counters: Math.floor(caUs) + (r() < caUs % 1 ? 1 : 0) };
    const B: Game = { ...b, counters: Math.floor(caThem) + (r() < caThem % 1 ? 1 : 0) };
    let g1 = 0,
      g2 = 0;
    for (let k = 0; k < 10; k++) {
      const ours = Math.floor(r() * 100) < possUs;
      const [att, def] = ours ? [A, B] : [B, A];
      const where = area(att, r);
      let goal: boolean;
      if (r() < 0.1) {
        // Sonderereignis: 25 % oder 75 % Torquote
        goal = r() * 100 < (r() < 0.5 ? 25 : 75);
      } else {
        goal = scores(att, where, r);
        // Konter des Verteidigers nach vergebener Chance, nur mit weniger Ballbesitz
        if (!goal && def.tactic === Tactic.counter && def.poss <= 0.5 && def.counters > 0) {
          def.counters--;
          if (scores(def, area(def, r), r)) {
            if (ours) g2++;
            else g1++;
          }
        }
      }
      if (goal) {
        if (ours) g1++;
        else g2++;
      }
    }
    gf += g1;
    ga += g2;
    if (g1 > g2) win++;
    else if (g1 === g2) draw++;
  }
  const W = win / n,
    D = draw / n;
  return { win: W, draw: D, loss: 1 - W - D, goalsFor: gf / n, goalsAgainst: ga / n, points: 3 * W + D };
}

export interface PlanOption {
  settings: MatchSettings;
  ratings: SectorRatings;
  hatStats: number;
  level: number | null;
  prediction: Prediction;
  label: string;
}

export interface MatchPlan {
  best: PlanOption;
  /** gleiche Taktik und Ausrichtung mit „Normal“ (Vergleichsbasis) */
  neutral: PlanOption;
  options: PlanOption[];
  attitude: { advice: number; text: string };
  notes: string[];
}

const STYLE_NAME: Record<number, string> = { [-10]: "defensiv", [-5]: "eher defensiv", 0: "ausgewogen", 5: "eher offensiv", 10: "offensiv" };
export const styleName = (s: number) => STYLE_NAME[s] ?? String(s);
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Alle sinnvollen Kombinationen aus Taktik und Ausrichtung mit der gegebenen Elf durchrechnen und nach
 * erwarteten Punkten ordnen. Einstellung (Spiel des Jahres / Nicht so ernst nehmen) wird getrennt bewertet,
 * weil sie die Stimmung der folgenden Wochen verändert.
 */
const fieldOf = (positions: FieldPosition[], byId: Map<number, Player>) =>
  positions.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour }));

/** Taktiken, die das Spielmodell abbildet (Pressing, Kreativ und Fernschüsse nicht) */
export const MODELLED_TACTICS = [Tactic.normal, Tactic.counter, Tactic.attackMiddle, Tactic.attackWings];

/** eine Einstellung mit der gegebenen Elf gegen den Gegner bewerten */
export function evaluateSettings(positions: FieldPosition[], byId: Map<number, Player>, settings: MatchSettings, team: TeamState, opponent: Side): PlanOption {
  const field = fieldOf(positions, byId);
  const ratings = new Evaluator(settings, team).ratings(field);
  const level = settings.tactic === Tactic.normal ? null : tacticLevel(field, settings.tactic);
  const prediction = predict({ ratings, tactic: settings.tactic, level }, opponent);
  return { settings, ratings, hatStats: hatStatsOf(ratings), level, prediction, label: `${TACTIC_NAME[settings.tactic]}, ${styleName(settings.styleOfPlay)}` };
}

export function planMatch(
  positions: FieldPosition[],
  byId: Map<number, Player>,
  base: MatchSettings,
  team: TeamState,
  opponent: Side,
  opts: { cup?: boolean } = {},
): MatchPlan {
  const tactics = MODELLED_TACTICS;
  const styles = [-10, -5, 0, 5, 10];
  const evalOption = (settings: MatchSettings): PlanOption => evaluateSettings(positions, byId, settings, team, opponent);
  const options: PlanOption[] = [];
  for (const tactic of tactics) for (const styleOfPlay of styles) options.push(evalOption({ ...base, attitude: Attitude.normal, tactic, styleOfPlay }));
  options.sort((a, b) => b.prediction.points - a.prediction.points || b.prediction.goalsFor - b.prediction.goalsAgainst - (a.prediction.goalsFor - a.prediction.goalsAgainst));
  const best = options[0];
  const neutral = options.find((o) => o.settings.tactic === Tactic.normal && o.settings.styleOfPlay === 0)!;

  // Einstellung: Spiel des Jahres nur, wenn es ein knappes Spiel deutlich kippt; „nicht so ernst“, wenn der Sieg trotzdem sicher ist
  const mots = evalOption({ ...best.settings, attitude: Attitude.mots });
  const pic = evalOption({ ...best.settings, attitude: Attitude.pic });
  let attitude: MatchPlan["attitude"];
  const gain = mots.prediction.points - best.prediction.points;
  if (pic.prediction.win >= 0.8) {
    attitude = {
      advice: Attitude.pic,
      text: `${ATTITUDE_NAME[Attitude.pic]} reicht: Siegchance bleibt bei ${pct(pic.prediction.win)}, und die Stimmung steigt für die nächsten Spiele.`,
    };
  } else if (gain >= 0.3 && best.prediction.win < 0.6) {
    attitude = {
      advice: Attitude.mots,
      text: `${ATTITUDE_NAME[Attitude.mots]} lohnt sich hier: Siegchance ${pct(best.prediction.win)} → ${pct(mots.prediction.win)} (+${gain.toFixed(2)} Punkte). Danach sinkt die Stimmung, also nur in einem entscheidenden Spiel${opts.cup ? " (Pokal)" : ""}.`,
    };
  } else {
    attitude = {
      advice: Attitude.normal,
      text: `Normal. Spiel des Jahres brächte nur +${Math.max(0, gain).toFixed(2)} Punkte (Siegchance ${pct(mots.prediction.win)}) und kostet danach Stimmung; aufheben für ein entscheidendes Spiel.`,
    };
  }

  const notes: string[] = [];
  if (best.settings.tactic !== Tactic.normal && best.level !== null)
    notes.push(`Taktikstärke ${TACTIC_NAME[best.settings.tactic]}: ${best.level.toFixed(1)}. Sie ergibt sich aus den Fertigkeiten der aufgestellten Spieler, einspielen muss man eine Taktik nicht.`);
  const diff = best.prediction.points - neutral.prediction.points;
  if (diff > 0.02) notes.push(`Gegenüber Normal/ausgewogen: +${diff.toFixed(2)} erwartete Punkte (Siegchance ${pct(neutral.prediction.win)} → ${pct(best.prediction.win)}).`);
  else notes.push("Normal und ausgewogen ist hier schon so gut wie die beste Einstellung.");
  return { best, neutral, options, attitude, notes };
}
