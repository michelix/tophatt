// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Trainer, Assistenztrainer und Spezialisten: Kosten und Trainingseffizienz.
//
// Effizienz wie die Hattrick-Sandbox „Trainingseffizienz“ (am 21.11.2026 mit zehn Einstellungen
// nachgerechnet, alle auf den Prozentpunkt genau):
//   Gesamteffizienz = (1 − Kondition) × Intensität × Trainerfaktor × (1 + 0,035 × Assistenzstufen) / 1,35
// Trainerfaktor = Trainingsgeschwindigkeit laut „Trainer wechseln“ (65/76/84/92/100 %),
// 1,35 = Bestwert mit zehn Assistenzstufen, damit Trainer 5 + 10 Stufen + 0 % Kondition = 100 %.
//
// Kosten aus dem Hattrick-Regelwerk (Spezialisten) und den Seiten „Trainer wechseln“.
// Die Funktionen sind bewusst ohne UI, damit der Finanzen-Bereich sie mitnutzen kann.

/** Trainingsgeschwindigkeit je Trainerstufe 1–5 */
export const TRAINER_SPEED = [0.65, 0.76, 0.84, 0.92, 1] as const;
/** Trainergehalt pro Woche (€) je Stufe 1–5 */
export const TRAINER_WEEKLY = [1250, 2500, 5000, 10000, 20000] as const;
/** Trainingsplus je Assistenzstufe (Summe beider Assistenten, max. 10) */
export const ASSISTANT_BONUS = 0.035;
export const MAX_ASSISTANT_LEVELS = 10;
const BEST = 1 + MAX_ASSISTANT_LEVELS * ASSISTANT_BONUS;

/** Wochenkosten eines Spezialisten der Stufe 1 je Vertragslänge 1–16 Wochen; Stufe n kostet × 2^(n−1) */
const STAFF_LEVEL1 = [2115, 2055, 1890, 1770, 1710, 1650, 1575, 1500, 1440, 1380, 1320, 1260, 1200, 1140, 1080, 1020];

/** Einmalpreis externer Trainer (€): Zeile = Trainerstufe 1–5, Spalte = Führungsqualität 3–7 (armselig … gut) */
const EXTERNAL_PRICE = [
  [10000, 10000, 10000, 10000, 10000],
  [10000, 22800, 41200, 65100, 94600],
  [79600, 182800, 329700, 521000, 757100],
  [268700, 617100, 1112900, 1758500, 2555500],
  [4000000, 4388400, 7914600, 12505200, 18172500],
];
/**
 * Eigener Spieler zum Trainer: bei Erfahrung passabel kostete Stufe 2/3 34 700/277 700 statt 65 100/521 000 extern
 * (externe Spalte „passabel“). Hattrick: „Die Kosten hängen von der Erfahrung des Spielers ab“, daher Spalte = Erfahrung.
 */
const INTERNAL_FACTOR = 34700 / 65100;

export const LEVEL_DE = ["nicht vorhanden", "katastrophal", "erbärmlich", "armselig", "schwach", "durchschnittlich", "passabel", "gut", "sehr gut", "hervorragend", "brillant", "bemerkenswert", "überragend", "Weltklasse", "übernatürlich", "titanisch", "außerirdisch", "mythisch", "märchenhaft", "galaktisch", "göttlich"];
export const levelName = (v: number) => LEVEL_DE[Math.max(0, Math.min(LEVEL_DE.length - 1, Math.round(v)))] ?? String(v);

export const STAFF_TYPE_DE: Record<number, string> = {
  1: "Assistenztrainer",
  2: "Sportmediziner",
  3: "Pressesprecher",
  4: "Sportpsychologe",
  5: "Formtrainer",
  6: "Finanzdirektor",
  7: "Taktik-Assistent",
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface TrainingSettings {
  /** Kondition-Anteil in % (Hattrick: mindestens 10) */
  staminaShare: number;
  /** Trainingsintensität in % */
  intensity: number;
  /** Trainerstufe 1–5 */
  trainerLevel: number;
  /** Summe der Assistenzstufen 0–10 */
  assistantLevels: number;
}

/** Gesamteffizienz 0…1 wie in der Hattrick-Sandbox (Fertigkeitstraining, ohne den Konditionsteil) */
export function trainingEfficiency(s: TrainingSettings): number {
  const trainer = TRAINER_SPEED[clamp(Math.round(s.trainerLevel), 1, 5) - 1];
  const assistants = 1 + clamp(s.assistantLevels, 0, MAX_ASSISTANT_LEVELS) * ASSISTANT_BONUS;
  return ((1 - clamp(s.staminaShare, 0, 100) / 100) * (clamp(s.intensity, 0, 100) / 100) * trainer * assistants) / BEST;
}

/** Wochenkosten eines Spezialisten (Assistent, Arzt …) je Stufe 1–5 und Vertragslänge 1–16 Wochen */
export function staffWeeklyCost(level: number, contractWeeks = 16): number {
  if (level <= 0) return 0;
  return STAFF_LEVEL1[clamp(Math.round(contractWeeks), 1, 16) - 1] * 2 ** (clamp(Math.round(level), 1, 5) - 1);
}

/** Vertragslänge aus Stufe und Wochenkosten zurückrechnen (z. B. Stufe 3 für 4 080 € → 16 Wochen), sonst null */
export function contractWeeksFor(level: number, weeklyCost: number): number | null {
  for (let w = 1; w <= 16; w++) if (Math.abs(staffWeeklyCost(level, w) - weeklyCost) < 1) return w;
  return null;
}

export const trainerWeekly = (level: number) => TRAINER_WEEKLY[clamp(Math.round(level), 1, 5) - 1];

/** Einmalpreis für einen externen Trainer; Führungsqualität außerhalb 3–7 wird auf den Rand gesetzt */
export function externalTrainerPrice(level: number, leadership: number): number {
  return EXTERNAL_PRICE[clamp(Math.round(level), 1, 5) - 1][clamp(Math.round(leadership), 3, 7) - 3];
}

/** Höchste Trainerstufe, die ein eigener Spieler mit dieser Erfahrung erreichen kann (passabel → 3, gut → 4, sehr gut → 5) */
export const maxTrainerLevelForExperience = (experience: number) => clamp(Math.floor(experience) - 3, 0, 5);

/**
 * Geschätzter Preis, um einen eigenen Spieler zum Trainer zu machen. Gemessen nur für Erfahrung und Führung passabel;
 * für andere Spieler zeigt Hattrick den genauen Preis unter „Trainer wechseln“. null = Stufe nicht erreichbar.
 */
export function internalTrainerPrice(level: number, experience: number): number | null {
  if (level > maxTrainerLevelForExperience(experience)) return null;
  if (level <= 1) return 10000;
  return Math.round((externalTrainerPrice(level, experience) * INTERNAL_FACTOR) / 100) * 100;
}

// --- Personal aus der HRF ------------------------------------------------------------------

export interface StaffMember {
  id: number;
  name: string;
  type: number;
  typeName: string;
  level: number;
  /** € pro Woche */
  weeklyCost: number;
  isTrainer: boolean;
  /** aus Stufe und Kosten zurückgerechnet, null wenn unbekannt */
  contractWeeks: number | null;
}

export interface TrainerInfo {
  id: number;
  name: string;
  level: number;
  leadership: number;
  weeklyCost: number;
}

export interface TrainerCandidate {
  id: number;
  name: string;
  age: number;
  experience: number;
  leadership: number;
  maxLevel: number;
  arrival: string;
}

export interface StaffSnapshot {
  trainer: TrainerInfo | null;
  members: StaffMember[];
  /** Summe Assistenzstufen laut [club] hjTranare (Fallback, wenn [staff] fehlt) */
  assistantLevels: number;
  intensity: number;
  staminaShare: number;
  trainingType: number;
  cash: number | null;
  candidates: TrainerCandidate[];
}

type Section = Map<string, string>;

function sections(raw: string): Map<string, Section> {
  const out = new Map<string, Section>();
  let cur: Section | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const h = /^\[(.+)\]\s*$/.exec(line);
    if (h) {
      cur = new Map();
      out.set(h[1].toLowerCase(), cur);
      continue;
    }
    const i = line.indexOf("=");
    if (cur && i > 0) cur.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return out;
}

const num = (s: Section | undefined, k: string, d = 0) => {
  const v = Number(s?.get(k.toLowerCase()));
  return Number.isFinite(v) && s?.get(k.toLowerCase()) !== "" ? v : d;
};

/** Personal, Trainingseinstellungen und Trainer-Kandidaten aus dem HRF-Text */
export function staffFromHrf(raw: string): StaffSnapshot {
  const sec = sections(raw);
  const xtra = sec.get("xtra");
  const rate = num(xtra, "CurrencyRate", 10) || 10;
  const trainerId = num(xtra, "TrainerID", num(sec.get("lineup"), "trainer"));
  const staff = sec.get("staff");
  const members: StaffMember[] = [];
  for (let i = 0; staff?.has(`staff${i}staffid`); i++) {
    const p = `staff${i}`;
    const id = num(staff, `${p}StaffId`);
    const type = num(staff, `${p}StaffType`);
    const level = num(staff, `${p}StaffLevel`);
    const weeklyCost = num(staff, `${p}Cost`) / rate;
    const isTrainer = id === trainerId;
    members.push({
      id,
      name: staff.get(`${p}name`) ?? "",
      type,
      typeName: isTrainer ? "Trainer" : STAFF_TYPE_DE[type] ?? `Typ ${type}`,
      level,
      weeklyCost,
      isTrainer,
      contractWeeks: isTrainer ? null : contractWeeksFor(level, weeklyCost),
    });
  }
  const tp = sec.get(`player${trainerId}`);
  let trainer: TrainerInfo | null = null;
  if (tp || trainerId) {
    const level = num(tp, "TrainerSkillLevel", members.find((m) => m.isTrainer)?.level ?? 0);
    const name = xtra?.get("trainername") || [tp?.get("firstname"), tp?.get("lastname")].filter(Boolean).join(" ") || "Trainer";
    trainer = {
      id: trainerId,
      name,
      level,
      leadership: num(tp, "led"),
      weeklyCost: members.find((m) => m.isTrainer)?.weeklyCost ?? (level ? trainerWeekly(level) : 0),
    };
  }
  const candidates: TrainerCandidate[] = [];
  for (const [name, s] of sec) {
    if (!name.startsWith("player") || name === `player${trainerId}`) continue;
    if (s.get("trainerstatus") && s.get("trainerstatus") !== "") continue;
    const experience = num(s, "rut");
    const maxLevel = maxTrainerLevelForExperience(experience);
    if (maxLevel < 1) continue;
    candidates.push({
      id: Number(name.slice(6)),
      name: [s.get("firstname"), s.get("lastname")].filter(Boolean).join(" ") || s.get("name") || name,
      age: num(s, "ald"),
      experience,
      leadership: num(s, "led"),
      maxLevel,
      arrival: s.get("arrivaldate") ?? "",
    });
  }
  candidates.sort((a, b) => b.maxLevel - a.maxLevel || b.leadership - a.leadership || b.experience - a.experience);
  const club = sec.get("club");
  const team = sec.get("team");
  const economy = sec.get("economy");
  const assistantsFromStaff = members.filter((m) => !m.isTrainer && m.type === 1).reduce((s, m) => s + m.level, 0);
  return {
    trainer,
    members,
    assistantLevels: staff ? assistantsFromStaff : Math.max(0, num(club, "hjTranare")),
    intensity: num(team, "trLevel", 100),
    staminaShare: num(team, "staminaTrainingPart", 15),
    trainingType: num(team, "trTypeValue", -1),
    cash: economy?.has("cash") ? num(economy, "Cash") / rate : null,
    candidates,
  };
}

/** Spieler kann laut Regelwerk erst nach 16 Wochen im Verein Trainer werden */
export function weeksInClub(arrival: string, now: Date): number | null {
  const t = Date.parse(arrival.replace(" ", "T"));
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / (7 * 864e5)) : null;
}

// --- Pläne vergleichen -------------------------------------------------------------------

export type TrainerSource = "keep" | "external" | "internal";

export interface StaffPlan {
  trainerSource: TrainerSource;
  trainerLevel: number;
  /** Führungsqualität des neuen Trainers (extern gewählt, intern die des Spielers) */
  leadership: number;
  /** Erfahrung des Spielers bei interner Beförderung */
  experience?: number;
  candidateId?: number;
  /** Stufen der zwei Assistenten-Plätze (0 = leer) */
  assistants: [number, number];
  /** Einmalpreis laut Hattrick, ersetzt die Schätzung (nur Trainerwechsel) */
  priceOverride?: number;
  /** Vertragslänge neuer Assistenten in Wochen */
  contractWeeks: number;
  intensity: number;
  staminaShare: number;
}

export interface PlanResult {
  efficiency: number;
  /** Wochenkosten Trainer + Assistenten (ohne andere Spezialisten) */
  weekly: number;
  oneTime: number;
  /** über den Zeitraum verteilte Kosten pro Woche */
  weeklyEquivalent: number;
}

/**
 * Kosten und Effizienz eines Plans. Bestehende Assistenten mit gleicher Stufe behalten ihre echten Kosten,
 * geänderte Plätze werden mit der gewählten Vertragslänge neu gerechnet.
 */
export function evaluatePlan(plan: StaffPlan, current: { assistants: { level: number; weeklyCost: number }[]; trainer: TrainerInfo | null }, horizonWeeks: number): PlanResult {
  const trainerLevel = plan.trainerSource === "keep" ? current.trainer?.level || plan.trainerLevel : plan.trainerLevel;
  const efficiency = trainingEfficiency({
    staminaShare: plan.staminaShare,
    intensity: plan.intensity,
    trainerLevel,
    assistantLevels: plan.assistants[0] + plan.assistants[1],
  });
  const pool = [...current.assistants];
  let weekly = plan.trainerSource === "keep" ? current.trainer?.weeklyCost || trainerWeekly(trainerLevel) : trainerWeekly(trainerLevel);
  for (const lvl of plan.assistants) {
    if (lvl <= 0) continue;
    const i = pool.findIndex((a) => a.level === lvl);
    if (i >= 0) weekly += pool.splice(i, 1)[0].weeklyCost;
    else weekly += staffWeeklyCost(lvl, plan.contractWeeks);
  }
  let oneTime = 0;
  if (plan.trainerSource === "external") oneTime = externalTrainerPrice(trainerLevel, plan.leadership);
  if (plan.trainerSource === "internal") oneTime = internalTrainerPrice(trainerLevel, plan.experience ?? 0) ?? Infinity;
  if (plan.trainerSource !== "keep" && plan.priceOverride && plan.priceOverride > 0) oneTime = plan.priceOverride;
  return { efficiency, weekly, oneTime, weeklyEquivalent: weekly + oneTime / Math.max(1, horizonWeeks) };
}

/** Günstigste Aufteilung einer Assistenz-Summe auf zwei Plätze (Kosten verdoppeln sich je Stufe, also möglichst gleich verteilen) */
export function splitAssistants(total: number): [number, number] {
  const t = clamp(Math.round(total), 0, MAX_ASSISTANT_LEVELS);
  return [Math.ceil(t / 2), Math.floor(t / 2)];
}

export interface PlanOption {
  label: string;
  plan: StaffPlan;
  result: PlanResult;
  /** Effizienz-Prozentpunkte gegenüber jetzt */
  gain: number;
  /** Mehrkosten pro Woche inkl. verteilter Einmalkosten gegenüber jetzt */
  extraWeekly: number;
  /** € pro Woche je zusätzlichem Effizienzpunkt, null ohne Gewinn */
  costPerPoint: number | null;
  affordable: boolean;
}

export interface OptionInput {
  snapshot: StaffSnapshot;
  horizonWeeks: number;
  /** Führungsqualität für externe Trainer */
  leadership: number;
  contractWeeks: number;
  /** Mindestbestand, der nach Einmalkosten bleiben soll */
  reserve: number;
  now: Date;
}

/** Aktueller Zustand als Plan */
export function currentPlan(s: StaffSnapshot): StaffPlan {
  const assistants = s.members.filter((m) => !m.isTrainer && m.type === 1).map((m) => m.level);
  const pair: [number, number] = assistants.length ? [assistants[0] ?? 0, assistants[1] ?? 0] : splitAssistants(s.assistantLevels);
  return {
    trainerSource: "keep",
    trainerLevel: s.trainer?.level || 3,
    leadership: s.trainer?.leadership ?? 6,
    assistants: pair,
    contractWeeks: 16,
    intensity: s.intensity,
    staminaShare: s.staminaShare,
  };
}

export function currentAssistants(s: StaffSnapshot) {
  const real = s.members.filter((m) => !m.isTrainer && m.type === 1);
  if (real.length) return real.map((m) => ({ level: m.level, weeklyCost: m.weeklyCost }));
  return splitAssistants(s.assistantLevels)
    .filter((l) => l > 0)
    .map((level) => ({ level, weeklyCost: staffWeeklyCost(level, 16) }));
}

/**
 * Alle sinnvollen Kombinationen aus Trainer (behalten / extern / eigener Spieler) und Assistenz-Summe 0–10,
 * bewertet gegen den aktuellen Stand. Trainingsintensität und Kondition bleiben wie jetzt.
 */
export function planOptions(o: OptionInput): { base: PlanResult; options: PlanOption[] } {
  const s = o.snapshot;
  const now = currentPlan(s);
  const cur = { assistants: currentAssistants(s), trainer: s.trainer };
  const base = evaluatePlan(now, cur, o.horizonWeeks);
  const trainers: { label: string; part: Pick<StaffPlan, "trainerSource" | "trainerLevel" | "leadership" | "experience" | "candidateId"> }[] = [
    { label: `Trainer behalten (Stufe ${now.trainerLevel})`, part: { trainerSource: "keep", trainerLevel: now.trainerLevel, leadership: now.leadership } },
  ];
  for (let l = 1; l <= 5; l++) {
    if (l <= now.trainerLevel) continue;
    trainers.push({ label: `Externer Trainer Stufe ${l} (Führung ${levelName(o.leadership)})`, part: { trainerSource: "external", trainerLevel: l, leadership: o.leadership } });
    const c = s.candidates
      .filter((c) => c.maxLevel >= l)
      .sort((a, b) => (internalTrainerPrice(l, a.experience) ?? Infinity) - (internalTrainerPrice(l, b.experience) ?? Infinity) || b.leadership - a.leadership)[0];
    if (c) trainers.push({ label: `${c.name} zum Trainer Stufe ${l}`, part: { trainerSource: "internal", trainerLevel: l, leadership: c.leadership, experience: c.experience, candidateId: c.id } });
  }
  const currentLevels = now.assistants[0] + now.assistants[1];
  const options: PlanOption[] = [];
  for (const t of trainers) {
    for (let total = 0; total <= MAX_ASSISTANT_LEVELS; total++) {
      // bestehende Assistenten behalten, wenn die Summe gleich bleibt
      const assistants = total === currentLevels ? now.assistants : bestPair(total, now.assistants);
      const plan: StaffPlan = { ...now, ...t.part, assistants, contractWeeks: o.contractWeeks };
      const result = evaluatePlan(plan, cur, o.horizonWeeks);
      const gain = (result.efficiency - base.efficiency) * 100;
      const extraWeekly = result.weeklyEquivalent - base.weeklyEquivalent;
      const label = `${t.label}, Assistenten ${assistantLabel(assistants)}`;
      options.push({
        label,
        plan,
        result,
        gain,
        extraWeekly,
        costPerPoint: gain > 0.05 ? extraWeekly / gain : null,
        affordable: s.cash == null || s.cash - result.oneTime >= o.reserve,
      });
    }
  }
  return { base, options };
}

export const assistantLabel = (a: [number, number]) => {
  const xs = a.filter((x) => x > 0);
  return xs.length ? xs.join(" + ") : "keine";
};

/** Paar mit Summe total, das einen bestehenden Assistenten möglichst behält und sonst am günstigsten ist */
function bestPair(total: number, existing: [number, number]): [number, number] {
  let best: [number, number] = splitAssistants(total);
  let bestCost = Infinity;
  for (let a = 0; a <= 5; a++) {
    const b = total - a;
    if (b < 0 || b > 5 || b > a) continue;
    // behaltene Assistenten kosten nichts extra, neue nach Tabelle
    const pool = existing.filter((x) => x > 0);
    let cost = 0;
    for (const lvl of [a, b]) {
      if (lvl <= 0) continue;
      const i = pool.indexOf(lvl);
      if (i >= 0) {
        pool.splice(i, 1);
        cost += staffWeeklyCost(lvl, 16) * 0.999; // gleiche Kosten, aber Bestand bevorzugen
      } else cost += staffWeeklyCost(lvl, 16);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = [a, b];
    }
  }
  return best;
}

/** Effizienz-Grenze: nur Optionen, die mehr Effizienz bringen als jede billigere. Sortiert nach Kosten. */
export function efficiencyFrontier(options: PlanOption[]): PlanOption[] {
  const sorted = [...options].filter((o) => Number.isFinite(o.result.weeklyEquivalent)).sort((a, b) => a.extraWeekly - b.extraWeekly || b.gain - a.gain);
  const out: PlanOption[] = [];
  let bestGain = -Infinity;
  for (const o of sorted) {
    if (o.result.efficiency * 100 > bestGain + 0.05) {
      out.push(o);
      bestGain = o.result.efficiency * 100;
    }
  }
  return out;
}
