// Auswechslungs-Vorschläge nach Kondition, Training und Einsatzzeit.
//
// Regeln (Hattrick-Regeln „Training“ und „Spielereigenschaften“, HO RatingPredictionModel.calcStamina):
// - Kondition: Ein Spieler baut ab Anpfiff ab, erholt sich zur Halbzeit teilweise und baut weiter ab.
//   Ein Einwechselspieler startet frisch (HO calcStamina mit startMinute = Einwechselminute).
// - Training: Minuten auf Trainingsposition aus allen Spielen der Woche zählen, höchstens 90, ab 1 Minute.
//   Teilen erzeugt nicht mehr Training, es verteilt es nur um.
// - Form: Für die neue Grundform zählt, OB ein Spieler in der Woche eingesetzt wurde („sehr wichtig“),
//   nicht wie lange. Konditionstraining: ≥ 90 Min 100 %, weniger 75 % + Anteil je Minute, gar nicht 50 %.
// - Hattrick erlaubt höchstens 3 Auswechslungen je Spiel.

import { type Lineup, type MatchOrder, type Player, Tactic } from "./model";
import { playerPositionRating, staminaFactor } from "./rating";
import { type TrainingDef, type WeekMinutes, trainingFor, trainingPriority } from "./training";

export type SubMode = "sieg" | "ausgewogen" | "training";

export const SUB_MODE_DE: Record<SubMode, string> = { sieg: "Sieg", ausgewogen: "Ausgewogen", training: "Training" };

export const MAX_SUBSTITUTIONS = 3;

/** Wie viel Teamstärke (Anteil über 90 Minuten) ein Modus für Training und Einsatzzeit hergeben darf */
export const MODE_BUDGET: Record<SubMode, number> = { sieg: 0, ausgewogen: 0.02, training: 1 };

/** Wert eines Einsatzes für Form und Konditionstraining, in denselben Einheiten wie der Trainingsnutzen (0 … 10) */
export const PARTICIPATION_VALUE = 2;

/** Standard-Minute für kurze Einsätze nur fürs Mitspielen */
export const LATE_MINUTE = 80;

/** HO GoalDiffCriteria 7 = mehr als 2 Tore vorne */
export const SAFE_LEAD = 7;

export type SubReason = "kondition" | "training" | "einsatz";

export interface SubSuggestion {
  playerOut: number;
  playerIn: number;
  role: number;
  minute: number;
  /** Bedingung Spielstand (HO GoalDiffCriteria), -1 = immer */
  standing: number;
  reason: SubReason;
  /** Teamstärke-Änderung über das Spiel in Prozent (positiv = stärker) */
  strengthPct: number;
  /** Trainingsnutzen (Summe Priorität × Anteil Trainingswoche), positiv = mehr Training */
  training: number;
  /** Einwechselspieler bekommt diese Woche seinen ersten Einsatz */
  firstAppearance: boolean;
  text: string;
}

export interface SubInput {
  lineup: Pick<Lineup, "positions" | "bench" | "tactic">;
  byId: Map<number, Player>;
  mode: SubMode;
  training?: TrainingDef;
  /** schon gespielte Trainingsminuten dieser Woche */
  week?: Map<number, WeekMinutes>;
  /** Auswechslungen, die schon als Anweisung stehen */
  existing?: MatchOrder[];
}

const MINUTES = 90;
const curveCache = new Map<string, number[]>();

/** Konditionsfaktor je Minute 0 … 89 für einen Spieler, der ab startMinute spielt */
function curve(stamina: number, start: number, tactic: number): number[] {
  const key = `${stamina}:${start}:${tactic === Tactic.pressing ? 1 : 0}`;
  let c = curveCache.get(key);
  if (!c) {
    c = Array.from({ length: MINUTES }, (_, m) => (m < start ? 0 : staminaFactor(stamina, m, start, tactic)));
    curveCache.set(key, c);
  }
  return c;
}

const sum = (a: number[], from = 0, to = MINUTES) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s;
};

/** Leistung eines Spielers auf einer Position über das ganze Spiel (Positionsstärke × Kondition je Minute) */
export function slotValue(p: Player, role: number, tactic: number): number {
  return playerPositionRating(p, role) * sum(curve(p.stamina, 0, tactic));
}

/**
 * Beste Wechselminute nur nach Stärke: A spielt bis t, B ab t frisch.
 * Ergebnis: Minute und Gewinn in Positionsstärke-Minuten (0, wenn ein Wechsel nichts bringt → Minute 90).
 */
export function bestStrengthMinute(a: Player, b: Player, role: number, tactic: number): { minute: number; gain: number } {
  const va = playerPositionRating(a, role);
  const vb = playerPositionRating(b, role);
  const ca = curve(a.stamina, 0, tactic);
  const keep = va * sum(ca);
  let best = { minute: MINUTES, gain: 0 };
  for (let t = 1; t < MINUTES; t++) {
    const v = va * sum(ca, 0, t) + vb * sum(curve(b.stamina, t, tactic), t);
    if (v - keep > best.gain + 1e-9) best = { minute: t, gain: v - keep };
  }
  return best;
}

/** Stärke-Änderung (Positionsstärke-Minuten) bei Wechsel in Minute t */
function strengthDelta(a: Player, b: Player, role: number, tactic: number, t: number): number {
  const va = playerPositionRating(a, role);
  const vb = playerPositionRating(b, role);
  return vb * sum(curve(b.stamina, t, tactic), t) - va * sum(curve(a.stamina, 0, tactic), t);
}

/** Restliche Trainingsminuten der Woche (volle Minuten zählen zuerst) */
function need(id: number, week?: Map<number, WeekMinutes>) {
  const w = week?.get(id);
  return Math.max(0, MINUTES - (w?.full ?? 0) - (w?.partly ?? 0));
}

const isKeeperType = (p: Player) => p.keeper > Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);

/** Gewicht der Teamstärke (je Prozent) gegenüber Trainings-/Einsatznutzen */
const STRENGTH_WEIGHT: Record<SubMode, number> = { sieg: 1, ausgewogen: 10, training: 1 };

const levelFactor = (role: number, t?: TrainingDef) => (!t ? 0 : trainingFor(role, t) === "voll" ? 1 : trainingFor(role, t) === "teilweise" ? 0.5 : 0);

/** Trainingsnutzen-Änderung: A spielt nur t statt 90 Minuten, B die restlichen 90 − t */
function trainingDelta(a: Player, b: Player, role: number, t: number, def?: TrainingDef, week?: Map<number, WeekMinutes>): number {
  const lv = levelFactor(role, def);
  if (!lv || !def) return 0;
  const na = need(a.id, week);
  const nb = need(b.id, week);
  const lostA = Math.max(0, Math.min(MINUTES, na) - Math.min(t, na));
  const gainB = Math.min(MINUTES - t, nb);
  return (lv * (trainingPriority(b, def) * gainB - trainingPriority(a, def) * lostA)) / MINUTES;
}

const hasPlayed = (id: number, week?: Map<number, WeekMinutes>) => {
  const w = week?.get(id);
  return !!w && w.full + w.partly > 0;
};

const lastName = (p?: Player) => (p?.name ?? "?").split(" ").slice(-1)[0];
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

interface Option extends SubSuggestion {
  score: number;
}

/**
 * Vorschläge für Auswechslungen, höchstens 3 minus schon vorhandene Wechsel.
 * Sieg: nur Wechsel, die die Mannschaft stärker machen (Kondition); Einsätze fürs Mitspielen nur bei
 * mehr als 2 Toren Vorsprung. Ausgewogen/Training: dazu Trainings- und Einsatzwechsel, solange die
 * Mannschaft insgesamt höchstens MODE_BUDGET an Stärke verliert.
 */
export function suggestSubstitutions(input: SubInput): SubSuggestion[] {
  const { lineup, byId, mode, training: def, week } = input;
  const tactic = lineup.tactic;
  const existing = (input.existing ?? []).filter((o) => o.kind === "sub");
  const usedOut = new Set(existing.map((o) => o.playerOut));
  const usedIn = new Set(existing.map((o) => o.playerIn));
  let slots = MAX_SUBSTITUTIONS - existing.length;
  if (slots <= 0) return [];

  const field = lineup.positions
    .map((pos) => ({ pos, p: byId.get(pos.playerId) }))
    .filter((x): x is { pos: (typeof lineup.positions)[number]; p: Player } => !!x.p && !usedOut.has(x.p.id));
  const bench = [...new Set(Object.values(lineup.bench).filter((x): x is number => !!x))]
    .map((id) => byId.get(id))
    .filter((p): p is Player => !!p && !usedIn.has(p.id) && !(p.injury > 0));
  const total = lineup.positions.reduce((s, pos) => {
    const p = byId.get(pos.playerId);
    return s + (p ? slotValue(p, pos.role, tactic) : 0);
  }, 0);
  if (!total || !bench.length) return [];
  const rel = (x: number) => (100 * x) / total;

  const options: Option[] = [];
  for (const { pos, p: a } of field) {
    for (const b of bench) {
      // Torwart nur gegen Torwart, Feldspieler nur gegen Feldspieler
      if ((pos.role === 100) !== isKeeperType(b)) continue;
      const first = !hasPlayed(b.id, week);
      const minutes = new Set<number>();
      const best = bestStrengthMinute(a, b, pos.role, tactic);
      if (best.gain > 0) minutes.add(best.minute);
      if (mode !== "sieg") {
        const na = need(a.id, week);
        if (na > 0 && na < MINUTES) minutes.add(na);
        const nb = need(b.id, week);
        if (nb > 0 && nb < MINUTES) minutes.add(MINUTES - nb);
        for (const t of [1, 30, 46, 60, 70, LATE_MINUTE]) minutes.add(t);
      }
      for (const t of minutes) {
        const s = rel(strengthDelta(a, b, pos.role, tactic, t));
        const tr = mode === "sieg" ? 0 : trainingDelta(a, b, pos.role, t, def, week);
        const part = first ? PARTICIPATION_VALUE : 0;
        if (mode === "sieg" ? s <= 0.05 : false) continue;
        const sv = STRENGTH_WEIGHT[mode] * s;
        const score = mode === "sieg" ? s : sv + tr + part;
        if (score <= 0.2) continue;
        const reason: SubReason = s > 0.05 && sv >= tr ? "kondition" : tr > 0.3 ? "training" : "einsatz";
        options.push({ playerOut: a.id, playerIn: b.id, role: pos.role, minute: t, standing: -1, reason, strengthPct: s, training: tr, firstAppearance: first, text: "", score });
      }
    }
  }

  // Gierig auswählen: jeder Spieler höchstens einmal, Stärke-Verlust im Budget
  options.sort((x, y) => y.score - x.score);
  const out: SubSuggestion[] = [];
  const outIds = new Set<number>();
  const inIds = new Set<number>();
  let loss = 0;
  const budget = MODE_BUDGET[mode] * 100;
  for (const o of options) {
    if (!slots) break;
    if (outIds.has(o.playerOut) || inIds.has(o.playerIn)) continue;
    const cost = Math.max(0, -o.strengthPct);
    if (loss + cost > budget + 1e-9) continue;
    loss += cost;
    outIds.add(o.playerOut);
    inIds.add(o.playerIn);
    out.push(o);
    slots--;
  }

  // Sieg (und Rest-Plätze): Bankspieler ohne Einsatz diese Woche kurz bringen, aber nur bei sicherem Vorsprung
  if (slots > 0) {
    const fresh = bench.filter((b) => !inIds.has(b.id) && !hasPlayed(b.id, week));
    for (const b of fresh) {
      if (!slots) break;
      // ersetzt den Feldspieler, dessen Platz B am wenigsten schwächt
      let pick: { a: Player; role: number; s: number } | null = null;
      for (const { pos, p: a } of field) {
        if (outIds.has(a.id) || (pos.role === 100) !== isKeeperType(b)) continue;
        const s = rel(strengthDelta(a, b, pos.role, tactic, LATE_MINUTE));
        if (!pick || s > pick.s) pick = { a, role: pos.role, s };
      }
      if (!pick) continue;
      outIds.add(pick.a.id);
      inIds.add(b.id);
      out.push({ playerOut: pick.a.id, playerIn: b.id, role: pick.role, minute: LATE_MINUTE, standing: SAFE_LEAD, reason: "einsatz", strengthPct: pick.s, training: 0, firstAppearance: true, text: "" });
      slots--;
    }
  }

  for (const o of out) o.text = describeSuggestion(o, byId, def, week);
  return out.sort((x, y) => x.minute - y.minute);
}

function describeSuggestion(o: SubSuggestion, byId: Map<number, Player>, def?: TrainingDef, week?: Map<number, WeekMinutes>): string {
  const a = byId.get(o.playerOut);
  const b = byId.get(o.playerIn);
  const parts: string[] = [];
  if (o.reason === "kondition") {
    parts.push(`${lastName(a)} hat Kondition ${a?.stamina}; ab Minute ${o.minute} ist ${lastName(b)} frisch stärker (${pct(o.strengthPct)} Teamstärke übers Spiel)`);
    if (a && b && playerPositionRating(b, o.role) >= playerPositionRating(a, o.role)) parts.push(`${lastName(b)} ist auf dieser Position sogar ausgeruht stärker: besser gleich in die Startelf`);
  }
  else if (o.reason === "training") {
    const na = a ? need(a.id, week) : 90;
    const why =
      na === 0
        ? `${lastName(a)} hat seine 90 Trainingsminuten der Woche schon`
        : na < 90 && o.minute === na
          ? `${lastName(a)} hat nach ${o.minute} Minuten seine 90 Trainingsminuten der Woche voll`
          : `${lastName(b)} hat mehr vom ${def?.name ?? ""}-Training (jünger oder Fertigkeit niedriger)`;
    parts.push(`${why}; ${lastName(b)} bekommt ${Math.min(90 - o.minute, b ? need(b.id, week) : 90)} Trainingsminuten`);
    if (o.minute <= 1) parts.push(`am besten gleich ${lastName(b)} statt ${lastName(a)} aufstellen`);
  } else parts.push(`${lastName(b)} kommt diese Woche sonst nicht zum Einsatz (wichtig für die Form, Konditionstraining 75 % statt 50 %)`);
  if (o.reason !== "einsatz" && o.firstAppearance) parts.push(`zugleich erster Einsatz der Woche für ${lastName(b)}`);
  if (o.standing === SAFE_LEAD) parts.push("nur bei mehr als 2 Toren Vorsprung");
  else if (o.strengthPct < -0.05) parts.push(`kostet ${pct(o.strengthPct).slice(1)} Teamstärke`);
  return parts.join(" · ");
}

/** Vorschlag als HO-Anweisung (Auswechslung, Position bleibt) */
export function suggestionToOrder(s: SubSuggestion): MatchOrder {
  return { kind: "sub", playerOut: s.playerOut, playerIn: s.playerIn, minute: s.minute, role: -1, behaviour: -1, card: -1, standing: s.standing };
}

/** Faustregel-Tabelle: beste Wechselminute je Kondition und Stärke des Ersatzes (Ersatz Kondition 6) */
export function ruleOfThumb(staminas = [3, 4, 5, 6, 7, 8], ratios = [1, 0.9, 0.8]): { stamina: number; minutes: (number | null)[] }[] {
  return staminas.map((s) => ({
    stamina: s,
    minutes: ratios.map((r) => {
      const ca = curve(s, 0, Tactic.normal);
      const keep = sum(ca);
      let best: number | null = null;
      let bestGain = 0.002 * keep;
      for (let t = 1; t < MINUTES; t++) {
        const g = sum(ca, 0, t) + r * sum(curve(6, t, Tactic.normal), t) - keep;
        if (g > bestGain) {
          bestGain = g;
          best = t;
        }
      }
      return best;
    }),
  }));
}
