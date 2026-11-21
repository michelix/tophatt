// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Vereinsfinanzen aus HRF-Dateien: Kontostand, Wochenbilanz, Personal und eine Prognose,
// ob geplante Ausgaben (Trainer, Assistenten, Spezialisten) den Verein in die Schulden treiben.
// Geld steht in der HRF in der Hattrick-Basiseinheit; [xtra] CurrencyRate rechnet in Euro um (EUR: 10).

import { parseSections } from "./hrf";

/** Hattrick-Regeln (Wirtschaft): Grenzen stehen dort in US$. */
export const RULES = {
  /** ab dieser Schuldenhöhe sind Ausgaben eingeschränkt */
  spendingLimitUsd: 200_000,
  /** ab dieser Schuldenhöhe gibt es die Bankrottwarnung … */
  bankruptcyWarningUsd: 500_000,
  /** … und so viele Wochen Zeit, wieder darüber zu kommen */
  bankruptcyGraceWeeks: 2,
};

/** Spezialisten-Typen wie in HOs [staff]-Abschnitt */
export const STAFF_TYPE_DE: Record<number, string> = {
  1: "Assistenztrainer",
  2: "Sportmediziner",
  3: "Pressesprecher",
  4: "Sportpsychologe",
  5: "Formtrainer",
  6: "Finanzdirektor",
  7: "Taktik-Assistent",
};

export interface StaffMember {
  id: number;
  name: string;
  type: number;
  typeName: string;
  level: number;
  /** Kosten pro Woche in Euro */
  weeklyCost: number;
  isTrainer: boolean;
}

/** Eine Wochenbilanz in Euro. Unregelmäßiges (Transfers, Prämien, Entlassungen) steckt in „other“. */
export interface WeekBalance {
  income: { spectators: number; sponsors: number; sponsorsBonus: number; other: number; sum: number };
  costs: { players: number; staff: number; arena: number; youth: number; other: number; sum: number };
  total: number;
}

export interface FinanceSnapshot {
  /** Zeitpunkt des HRF-Downloads */
  date: string;
  /** nächstes Wirtschaftsupdate laut HO */
  economyDate: string;
  cash: number;
  /** Kontostand zum nächsten Wirtschaftsupdate laut Hattrick (ohne noch nicht gespielte Heimspiele) */
  expectedCash: number;
  thisWeek: WeekBalance;
  lastWeek: WeekBalance;
  staff: StaffMember[];
  supportersPopularity: number;
  fanclub: number;
}

const num = (p: Map<string, string> | undefined, key: string): number => {
  const v = p?.get(key.toLowerCase());
  const n = v === undefined || v === "" ? 0 : Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function balance(e: Map<string, string> | undefined, prefix: "" | "last", rate: number): WeekBalance {
  const g = (k: string) => num(e, prefix + k) / rate;
  const spectators = g("IncomeSpectators");
  const sponsors = g("IncomeSponsors");
  const sponsorsBonus = g("IncomeSponsorsBonus");
  const incomeSum = g("IncomeSum");
  const players = g("CostsPlayers");
  // die laufende Woche heißt CostsStaff, die Vorwoche lastCostsPersonal
  const staff = prefix ? g("CostsPersonal") : g("CostsStaff");
  const arena = g("CostsArena");
  const youth = g("CostsYouth");
  const costSum = g("CostsSum");
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    income: { spectators, sponsors, sponsorsBonus, other: r(incomeSum - spectators - sponsors - sponsorsBonus), sum: incomeSum },
    costs: { players, staff, arena, youth, other: r(costSum - players - staff - arena - youth), sum: costSum },
    total: r(incomeSum - costSum),
  };
}

/** Spezialisten aus [staff]; der Trainer steht dort auch (StaffId = TrainerID). */
export function parseStaff(text: string): StaffMember[] {
  const sections = parseSections(text);
  const get = (n: string) => sections.find((s) => s.name === n)?.props;
  const xtra = get("xtra");
  const rate = num(xtra, "CurrencyRate") || 1;
  const trainerId = num(xtra, "TrainerID");
  const s = get("staff");
  if (!s) return [];
  const out: StaffMember[] = [];
  for (let i = 0; s.has(`staff${i}staffid`); i++) {
    const id = num(s, `staff${i}StaffId`);
    const type = num(s, `staff${i}StaffType`);
    const isTrainer = id === trainerId;
    out.push({
      id,
      name: s.get(`staff${i}name`) || (isTrainer ? str(xtra, "trainername") : ""),
      type,
      typeName: isTrainer ? "Trainer" : (STAFF_TYPE_DE[type] ?? `Spezialist (${type})`),
      level: num(s, `staff${i}StaffLevel`),
      weeklyCost: num(s, `staff${i}Cost`) / rate,
      isTrainer,
    });
  }
  return out.sort((a, b) => Number(b.isTrainer) - Number(a.isTrainer) || a.type - b.type || b.level - a.level);
}

const str = (p: Map<string, string> | undefined, k: string) => p?.get(k) ?? "";

/** null, wenn die Datei keinen [economy]-Abschnitt hat. */
export function parseFinance(text: string): FinanceSnapshot | null {
  const sections = parseSections(text);
  const get = (n: string) => sections.find((s) => s.name === n)?.props;
  const e = get("economy");
  if (!e) return null;
  const xtra = get("xtra");
  const rate = num(xtra, "CurrencyRate") || 1;
  return {
    date: str(get("basics"), "date"),
    economyDate: str(xtra, "economydate"),
    cash: num(e, "Cash") / rate,
    expectedCash: (e.has("expectedcash") ? num(e, "ExpectedCash") : num(e, "Cash")) / rate,
    thisWeek: balance(e, "", rate),
    lastWeek: balance(e, "last", rate),
    staff: parseStaff(text),
    supportersPopularity: num(e, "SupportersPopularity"),
    fanclub: num(get("club"), "fanclub"),
  };
}

/** Eine abgeschlossene Woche aus der Historie (Vorwoche einer HRF), Schlüssel = Datum des Wirtschaftsupdates. */
export interface PastWeek {
  /** Wirtschaftsupdate, mit dem die Woche abgerechnet wurde (yyyy-mm-dd) */
  week: string;
  /** Kontostand direkt nach diesem Update (soweit bekannt) */
  balance: WeekBalance;
}

const day = (s: string) => s.slice(0, 10);
const minusDays = (s: string, d: number) => {
  const t = new Date(day(s) + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - d);
  return t.toISOString().slice(0, 10);
};

/** Abgeschlossene Wochen aus mehreren Snapshots, je Woche einmal, älteste zuerst. */
export function pastWeeks(snaps: FinanceSnapshot[]): PastWeek[] {
  const byWeek = new Map<string, { date: string; w: PastWeek }>();
  for (const s of snaps) {
    if (!s.economyDate || s.lastWeek.income.sum === 0 && s.lastWeek.costs.sum === 0) continue;
    const week = minusDays(s.economyDate, 7);
    const prev = byWeek.get(week);
    // die spätere Datei gewinnt (gleiche Zahlen, aber sicher vollständig)
    if (!prev || s.date > prev.date) byWeek.set(week, { date: s.date, w: { week, balance: s.lastWeek } });
  }
  return [...byWeek.values()].map((x) => x.w).sort((a, b) => a.week.localeCompare(b.week));
}

/** Typische Woche: laufende Kosten wie jetzt, Sponsoren wie jetzt, Zuschauer im Schnitt der bekannten Wochen. */
export interface NormalWeek {
  spectators: number;
  sponsors: number;
  costs: number;
  total: number;
  /** wie viele abgeschlossene Wochen in den Zuschauerschnitt eingehen */
  basedOnWeeks: number;
}

export function normalWeek(s: FinanceSnapshot, history: PastWeek[] = []): NormalWeek {
  const weeks = history.length ? history.map((w) => w.balance) : [s.lastWeek];
  const spectators = weeks.reduce((a, w) => a + w.income.spectators, 0) / weeks.length;
  const sponsors = s.thisWeek.income.sponsors + s.thisWeek.income.sponsorsBonus;
  const c = s.thisWeek.costs;
  const costs = c.players + c.staff + c.arena + c.youth;
  return { spectators, sponsors, costs, total: spectators + sponsors - costs, basedOnWeeks: weeks.length };
}

export interface Plan {
  /** zusätzliche Kosten pro Woche (negativ = Ersparnis) */
  extraWeeklyCost: number;
  /** einmalige Kosten (z. B. Trainerkauf) sofort */
  oneTimeCost: number;
}

export interface Affordability {
  verdict: "ok" | "knapp" | "gefahr";
  /** niedrigster Kontostand in der Prognose und in welcher Woche (0 = nach dem nächsten Update) */
  minCash: number;
  minWeek: number;
  /** Wochen bis der Kontostand unter 0 fällt, null = nicht im Zeitraum */
  weeksUntilDebt: number | null;
  /** höchste zusätzliche Wochenkosten, bei denen der Puffer im ganzen Zeitraum hält */
  maxExtraWeekly: number;
  /** in wie vielen Wochen (Ansparen mit typischen Wochen) der Plan den Puffer hält; 0 = sofort, null = nicht binnen eines Jahres */
  affordableInWeeks: number | null;
  /** Kontostand je Woche, Index 0 = nach dem nächsten Wirtschaftsupdate */
  forecast: number[];
  text: string;
}

export const DEFAULT_HORIZON = 16;
export const DEFAULT_BUFFER = 100_000;

/**
 * Kontostand-Prognose mit Plan. Startpunkt ist der erwartete Stand zum nächsten Update;
 * danach jede Woche der Saldo einer typischen Woche, plus/minus Plan.
 */
export function forecast(s: FinanceSnapshot, normal: NormalWeek, plan: Plan, weeks = DEFAULT_HORIZON): number[] {
  const out: number[] = [];
  let cash = s.expectedCash - plan.oneTimeCost - plan.extraWeeklyCost;
  out.push(cash);
  for (let w = 1; w < weeks; w++) {
    cash += normal.total - plan.extraWeeklyCost;
    out.push(cash);
  }
  return out;
}

const eur = (x: number) => `${Math.round(x).toLocaleString("de-DE")} €`;

export function checkAffordability(
  s: FinanceSnapshot,
  plan: Plan,
  opts: { normal?: NormalWeek; weeks?: number; buffer?: number } = {},
): Affordability {
  const normal = opts.normal ?? normalWeek(s);
  const weeks = opts.weeks ?? DEFAULT_HORIZON;
  const buffer = opts.buffer ?? DEFAULT_BUFFER;
  const fc = forecast(s, normal, plan, weeks);
  let minWeek = 0;
  fc.forEach((c, i) => {
    if (c < fc[minWeek]) minWeek = i;
  });
  const minCash = fc[minWeek];
  const debtAt = fc.findIndex((c) => c < 0);
  // Grenze: expectedCash - oneTime - x*(w+1) + normal.total*w >= buffer für alle w < weeks
  let maxExtra = Infinity;
  for (let w = 0; w < weeks; w++) maxExtra = Math.min(maxExtra, (s.expectedCash - plan.oneTimeCost - buffer + normal.total * w) / (w + 1));
  let affordableInWeeks: number | null = null;
  // Ansparen hilft nur, wenn der Plan die typische Woche nicht ins Minus dreht
  const maxWait = normal.total - plan.extraWeeklyCost >= 0 ? 52 : 0;
  for (let k = 0; k <= maxWait && affordableInWeeks === null; k++) {
    const later = forecast({ ...s, expectedCash: s.expectedCash + normal.total * k }, normal, plan, weeks);
    if (Math.min(...later) >= buffer) affordableInWeeks = k;
  }
  const verdict: Affordability["verdict"] = minCash < 0 ? "gefahr" : minCash < buffer ? "knapp" : "ok";
  const text =
    verdict === "gefahr"
      ? `In Woche ${debtAt + 1} rutscht das Konto ins Minus (tiefster Stand ${eur(minCash)}). Schulden kosten hohe Zinsen; ab ${RULES.bankruptcyWarningUsd.toLocaleString("de-DE")} US$ Schulden droht die Bankrottwarnung.`
      : verdict === "knapp"
        ? `Es bleibt im Plus, aber in Woche ${minWeek + 1} nur ${eur(minCash)} – unter dem Puffer von ${eur(buffer)}.`
        : `Tragbar: tiefster Stand ${eur(minCash)} in Woche ${minWeek + 1}, Puffer ${eur(buffer)} hält.`;
  return { verdict, minCash, minWeek, weeksUntilDebt: debtAt < 0 ? null : debtAt + 1, maxExtraWeekly: Math.floor(maxExtra), affordableInWeeks, forecast: fc, text };
}
