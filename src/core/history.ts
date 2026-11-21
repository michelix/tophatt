// Verlauf: je Trainingswoche ein Schnappschuss aller wichtigen Einstellungen und Ergebnisse,
// damit sich der Aufstiegsplan über Wochen prüfen lässt (Training, Trainer/Assistenten,
// Personal, Finanzen, Mannschaft, Kader). Quelle ist die HRF-Datei aus HO; das Archiv
// bleibt erhalten, auch wenn alte HRF-Dateien gelöscht werden.

import { parseHrf, parseSections } from "./hrf";

export const HISTORY_FORMAT = 1;

/** Personal-Typen laut Hattrick/HO (StaffType) */
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
  type: number;
  level: number;
  /** Kosten pro Woche in € */
  cost: number;
}

export interface SnapshotPlayer {
  id: number;
  name: string;
  age: number;
  ageDays: number;
  keeper: number;
  defending: number;
  playmaking: number;
  winger: number;
  passing: number;
  scoring: number;
  setPieces: number;
  stamina: number;
  form: number;
  experience: number;
  tsi: number;
  salary: number;
}

export interface WeekSnapshot {
  /** Freitag, an dem die Trainingswoche beginnt (JJJJ-MM-TT, Ortszeit) */
  week: string;
  /** Zeitpunkt des HO-Downloads, aus dem der Schnappschuss stammt */
  hrfDate: string;
  season: number;
  round: number;
  training: { type: number; typeName: string; intensity: number; staminaShare: number };
  staff: {
    /** Trainerfähigkeit 1–5 (null = nicht in der HRF) */
    trainerLevel: number | null;
    /** 0 defensiv, 1 offensiv, 2 ausgeglichen, -1 unbekannt */
    trainerType: number;
    /** Gehalt des Trainers pro Woche in € (null = unbekannt) */
    trainerSalary: number | null;
    /** Summe der Assistenztrainer-Stufen */
    assistants: number;
    medics: number;
    psychologists: number;
    spokespersons: number;
    formCoaches: number;
    financialDirectors: number;
    tacticalAssistants: number;
    members: StaffMember[];
    /** Trainer + Spezialisten pro Woche in € (null = keine Angaben in der HRF) */
    costPerWeek: number | null;
  };
  /** Geldwerte in €; null, wenn die HRF keine Finanzen enthält */
  finance: {
    cash: number;
    expectedCash: number | null;
    /** abgeschlossene Vorwoche */
    lastIncome: number;
    lastCosts: number;
    lastWages: number;
    lastStaffCosts: number;
    /** laufende Woche bis zum Download */
    income: number;
    costs: number;
  } | null;
  team: {
    spirit: number;
    confidence: number;
    leagueName: string;
    leaguePosition: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    powerRating: number;
    fans: number;
    formationExperience: Record<string, number>;
  };
  squad: SnapshotPlayer[];
  /** Planwerte anderer Bereiche zum Zeitpunkt der Woche (z. B. "trainerPlan"), frei erweiterbar */
  plans?: Record<string, unknown>;
  /** eigene Notiz zur Woche (warum wurde etwas geändert, was ist der Plan) */
  note?: string;
}

export interface HistoryArchive {
  format: number;
  weeks: WeekSnapshot[];
}

export const emptyArchive = (): HistoryArchive => ({ format: HISTORY_FORMAT, weeks: [] });

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Trainingswoche (Freitag) zu einem Zeitpunkt. Das Training läuft Freitag früh, danach gilt die neue Woche. */
export function weekOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const back = (d.getDay() - 5 + 7) % 7; // 5 = Freitag
  d.setDate(d.getDate() - back);
  return ymd(d);
}

const parseLocal = (s: string) => new Date(s.replace(" ", "T"));

/** Schnappschuss aus dem Text einer HRF-Datei. null, wenn es keine HO-Datei mit Spielern ist. */
export function snapshotFromHrf(text: string): WeekSnapshot | null {
  const hrf = parseHrf(text);
  const date = parseLocal(hrf.team.hrfDate);
  if (!hrf.players.length || isNaN(date.getTime())) return null;
  const sections = parseSections(text);
  const get = (name: string) => sections.find((s) => s.name === name)?.props ?? new Map<string, string>();
  const num = (p: Map<string, string>, k: string, d = 0) => {
    const v = p.get(k);
    if (v === undefined || v === "" || v === "null") return d;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : d;
  };
  const xtra = get("xtra");
  const rate = num(xtra, "currencyrate", 1) || 1;
  const club = get("club");
  const league = get("league");
  const economy = get("economy");
  const staffSec = get("staff");
  const trainer = get(`player${hrf.team.trainerId}`);
  const t = hrf.team;

  const members: StaffMember[] = [];
  for (let i = 0; staffSec.has(`staff${i}stafftype`); i++) {
    members.push({ type: num(staffSec, `staff${i}stafftype`), level: num(staffSec, `staff${i}stafflevel`), cost: num(staffSec, `staff${i}cost`) / rate });
  }
  const levelSum = (type: number, fallback: number) => (members.length ? members.filter((m) => m.type === type).reduce((s, m) => s + m.level, 0) : fallback);
  const trainerLevel = trainer.has("trainerskilllevel") && trainer.get("trainerskilllevel") !== "" ? num(trainer, "trainerskilllevel") : null;
  const trainerSalary = trainer.get("sal") ? num(trainer, "sal") / rate : null;
  const staffCost = members.reduce((s, m) => s + m.cost, 0);
  const costPerWeek = members.length || trainerSalary !== null ? staffCost + (trainerSalary ?? 0) : null;

  const money = (k: string) => num(economy, k) / rate;
  const hasEconomy = economy.size > 0 && [...economy.values()].some((v) => v !== "0" && v !== "false" && v !== "");

  return {
    week: weekOf(date),
    hrfDate: t.hrfDate,
    season: t.season,
    round: t.matchRound,
    training: { type: t.trainingType, typeName: t.trainingTypeName, intensity: t.trainingLevel, staminaShare: t.staminaTrainingPart },
    staff: {
      trainerLevel,
      trainerType: t.trainerType,
      trainerSalary,
      assistants: levelSum(1, Math.max(0, t.assistantsLevel)),
      medics: levelSum(2, num(club, "lakare")),
      spokespersons: levelSum(3, num(club, "presstalesman")),
      psychologists: levelSum(4, num(club, "psykolog")),
      formCoaches: levelSum(5, num(club, "formcoachlevels")),
      financialDirectors: levelSum(6, num(club, "financialdirectorlevels")),
      tacticalAssistants: levelSum(7, num(club, "tacticalassistantlevels")),
      members,
      costPerWeek,
    },
    finance: hasEconomy
      ? {
          cash: money("cash"),
          expectedCash: economy.has("expectedcash") ? money("expectedcash") : null,
          lastIncome: money("lastincomesum"),
          lastCosts: money("lastcostssum"),
          lastWages: money("lastcostsplayers"),
          lastStaffCosts: economy.has("lastcostsstaff") ? money("lastcostsstaff") : money("lastcostspersonal"),
          income: money("incomesum"),
          costs: money("costssum"),
        }
      : null,
    team: {
      spirit: t.teamSpirit,
      confidence: t.confidence,
      leagueName: t.leagueName,
      leaguePosition: t.leaguePosition,
      points: num(league, "poang"),
      goalsFor: num(league, "gjorda"),
      goalsAgainst: num(league, "inslappta"),
      powerRating: num(club, "powerrating"),
      fans: num(club, "fanclub"),
      formationExperience: { ...t.formationExperience },
    },
    squad: hrf.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        age: p.age,
        ageDays: p.ageDays,
        keeper: p.keeper,
        defending: p.defending,
        playmaking: p.playmaking,
        winger: p.winger,
        passing: p.passing,
        scoring: p.scoring,
        setPieces: p.setPieces,
        stamina: p.stamina,
        form: p.form,
        experience: p.experience,
        tsi: p.tsi,
        salary: p.salary,
      }))
      .sort((a, b) => a.id - b.id),
  };
}

/**
 * Schnappschuss ins Archiv übernehmen. Je Woche gilt der neueste Download; Notiz und Planwerte
 * der Woche bleiben erhalten. Gibt true zurück, wenn sich das Archiv geändert hat.
 */
export function mergeSnapshot(a: HistoryArchive, s: WeekSnapshot): boolean {
  const i = a.weeks.findIndex((w) => w.week === s.week);
  if (i < 0) {
    a.weeks.push(s);
    a.weeks.sort((x, y) => x.week.localeCompare(y.week));
    return true;
  }
  const old = a.weeks[i];
  if (s.hrfDate < old.hrfDate) {
    // älterer Download derselben Woche: nur fehlende Notiz/Planwerte ergänzen
    let changed = false;
    if (!old.note && s.note) (old.note = s.note), (changed = true);
    if (s.plans) for (const [k, v] of Object.entries(s.plans)) if (!old.plans || !(k in old.plans)) (old.plans ??= {})[k] = v, (changed = true);
    return changed;
  }
  const same = s.hrfDate === old.hrfDate;
  const merged: WeekSnapshot = { ...s, note: s.note || old.note, plans: old.plans || s.plans ? { ...old.plans, ...s.plans } : undefined };
  if (!merged.note) delete merged.note;
  if (!merged.plans) delete merged.plans;
  if (same && JSON.stringify(merged) === JSON.stringify(old)) return false;
  a.weeks[i] = merged;
  return true;
}

/** Archive zusammenführen (z. B. Datei-Import oder Datei im Datenordner). */
export function mergeArchives(into: HistoryArchive, from: HistoryArchive): number {
  let n = 0;
  for (const w of from.weeks) if (mergeSnapshot(into, structuredCloneSafe(w))) n++;
  return n;
}

const structuredCloneSafe = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Archiv aus JSON lesen; unbekannte oder kaputte Daten ergeben ein leeres Archiv. */
export function parseArchive(json: string | null | undefined): HistoryArchive {
  if (!json) return emptyArchive();
  try {
    const raw = JSON.parse(json) as Partial<HistoryArchive>;
    const weeks = Array.isArray(raw.weeks) ? raw.weeks.filter((w) => w && typeof w.week === "string" && w.training && w.staff && w.team && Array.isArray(w.squad)) : [];
    return { format: HISTORY_FORMAT, weeks: weeks.sort((x, y) => x.week.localeCompare(y.week)) };
  } catch {
    return emptyArchive();
  }
}

export const serializeArchive = (a: HistoryArchive) => JSON.stringify(a);

// --- Änderungen zwischen zwei Wochen -------------------------------------------------

export type ChangeKind = "setting" | "staff" | "result" | "squad" | "skill";

export interface Change {
  kind: ChangeKind;
  label: string;
  from?: string;
  to?: string;
  /** +1 besser, -1 schlechter, 0 neutral (für die Färbung) */
  tone: -1 | 0 | 1;
}

export const SKILL_KEYS = ["keeper", "defending", "playmaking", "winger", "passing", "scoring", "setPieces", "stamina"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export const SKILL_DE: Record<SkillKey, string> = {
  keeper: "Torwart",
  defending: "Verteidigung",
  playmaking: "Spielaufbau",
  winger: "Flügelspiel",
  passing: "Passspiel",
  scoring: "Torschuss",
  setPieces: "Standards",
  stamina: "Kondition",
};

const TRAINER_TYPE_DE: Record<number, string> = { 0: "defensiv", 1: "offensiv", 2: "ausgeglichen" };
const SPIRIT_DE = ["am Boden", "katastrophal", "schlecht", "ruhig", "ruhig", "zufrieden", "gut", "sehr gut", "himmelhoch", "euphorisch", "paradiesisch"];

export const euro = (v: number) => `${Math.round(v).toLocaleString("de-DE")} €`;
const signed = (v: number, f: (x: number) => string) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${f(Math.abs(v))}`;

export interface SkillUp {
  id: number;
  name: string;
  skill: SkillKey;
  from: number;
  to: number;
}

/** Fähigkeitssprünge (ganze Stufen) zwischen zwei Wochen, nur Spieler, die in beiden Wochen da sind */
export function skillChanges(prev: WeekSnapshot, cur: WeekSnapshot): SkillUp[] {
  const before = new Map(prev.squad.map((p) => [p.id, p]));
  const out: SkillUp[] = [];
  for (const p of cur.squad) {
    const o = before.get(p.id);
    if (!o) continue;
    for (const k of SKILL_KEYS) if (p[k] !== o[k]) out.push({ id: p.id, name: p.name, skill: k, from: o[k], to: p[k] });
  }
  return out;
}

/** Was hat sich von einer Woche zur nächsten geändert? Einstellungen zuerst, dann Folgen. */
export function diffWeeks(prev: WeekSnapshot, cur: WeekSnapshot): Change[] {
  const c: Change[] = [];
  const set = (kind: ChangeKind, label: string, a: unknown, b: unknown, fmt: (x: never) => string = String as never, tone: -1 | 0 | 1 = 0) => {
    if (a === b || a === undefined || b === undefined) return;
    c.push({ kind, label, from: a === null ? "–" : fmt(a as never), to: b === null ? "–" : fmt(b as never), tone });
  };
  const dir = (a: number | null, b: number | null, higherIsBetter = true): -1 | 0 | 1 => (a === null || b === null || a === b ? 0 : (b > a) === higherIsBetter ? 1 : -1);

  // Einstellungen
  if (prev.training.type !== cur.training.type) c.push({ kind: "setting", label: "Trainingsart", from: prev.training.typeName || String(prev.training.type), to: cur.training.typeName || String(cur.training.type), tone: 0 });
  set("setting", "Trainingsintensität", prev.training.intensity, cur.training.intensity, (x: number) => `${x} %`, dir(prev.training.intensity, cur.training.intensity));
  set("setting", "Konditionsanteil", prev.training.staminaShare, cur.training.staminaShare, (x: number) => `${x} %`);
  const ps = prev.staff,
    cs = cur.staff;
  set("staff", "Trainerfähigkeit", ps.trainerLevel, cs.trainerLevel, String, dir(ps.trainerLevel, cs.trainerLevel));
  set("staff", "Trainertyp", ps.trainerType, cs.trainerType, (x: number) => TRAINER_TYPE_DE[x] ?? "unbekannt");
  set("staff", "Assistenztrainer (Stufen)", ps.assistants, cs.assistants, String, dir(ps.assistants, cs.assistants));
  set("staff", "Sportmediziner", ps.medics, cs.medics, String, dir(ps.medics, cs.medics));
  set("staff", "Sportpsychologe", ps.psychologists, cs.psychologists, String, dir(ps.psychologists, cs.psychologists));
  set("staff", "Formtrainer", ps.formCoaches, cs.formCoaches, String, dir(ps.formCoaches, cs.formCoaches));
  set("staff", "Taktik-Assistent", ps.tacticalAssistants, cs.tacticalAssistants, String, dir(ps.tacticalAssistants, cs.tacticalAssistants));
  set("staff", "Finanzdirektor", ps.financialDirectors, cs.financialDirectors, String, dir(ps.financialDirectors, cs.financialDirectors));
  set("staff", "Pressesprecher", ps.spokespersons, cs.spokespersons, String, dir(ps.spokespersons, cs.spokespersons));
  if (ps.costPerWeek !== null && cs.costPerWeek !== null && Math.round(ps.costPerWeek) !== Math.round(cs.costPerWeek))
    c.push({ kind: "staff", label: "Personalkosten pro Woche", from: euro(ps.costPerWeek), to: euro(cs.costPerWeek), tone: dir(ps.costPerWeek, cs.costPerWeek, false) });

  // Kader: Zu- und Abgänge
  const prevIds = new Set(prev.squad.map((p) => p.id));
  const curIds = new Set(cur.squad.map((p) => p.id));
  for (const p of cur.squad) if (!prevIds.has(p.id)) c.push({ kind: "squad", label: `Neu im Kader: ${p.name}`, tone: 0 });
  for (const p of prev.squad) if (!curIds.has(p.id)) c.push({ kind: "squad", label: `Abgang: ${p.name}`, tone: 0 });

  // Ergebnisse
  for (const u of skillChanges(prev, cur))
    c.push({ kind: "skill", label: `${u.name}: ${SKILL_DE[u.skill]}`, from: String(u.from), to: String(u.to), tone: u.to > u.from ? 1 : -1 });
  if (prev.finance && cur.finance && Math.round(prev.finance.cash) !== Math.round(cur.finance.cash))
    c.push({ kind: "result", label: "Kontostand", from: euro(prev.finance.cash), to: euro(cur.finance.cash), tone: dir(prev.finance.cash, cur.finance.cash) });
  set("result", "Tabellenplatz", prev.team.leaguePosition || null, cur.team.leaguePosition || null, (x: number) => `${x}.`, dir(prev.team.leaguePosition, cur.team.leaguePosition, false));
  set("result", "Teamstimmung", prev.team.spirit, cur.team.spirit, (x: number) => SPIRIT_DE[x] ?? String(x), dir(prev.team.spirit, cur.team.spirit));
  set("result", "Selbstvertrauen", prev.team.confidence, cur.team.confidence, String, dir(prev.team.confidence, cur.team.confidence));
  return c;
}

/** Kennzahlen je Woche für Diagramme und Tabelle */
export interface WeekMetrics {
  week: string;
  cash: number | null;
  staffCost: number | null;
  lastWeekResult: number | null;
  trainerLevel: number | null;
  assistants: number;
  intensity: number;
  staminaShare: number;
  leaguePosition: number | null;
  spirit: number;
  confidence: number;
  tsiSum: number;
  wageSum: number;
  /** ganze Fähigkeitsstufen gewonnen seit der Vorwoche (ohne Kondition), null in der ersten Woche */
  skillUps: number | null;
  skillDowns: number | null;
}

export function weekMetrics(weeks: WeekSnapshot[]): WeekMetrics[] {
  return weeks.map((w, i) => {
    const prev = i > 0 ? weeks[i - 1] : null;
    const ch = prev ? skillChanges(prev, w).filter((u) => u.skill !== "stamina") : null;
    return {
      week: w.week,
      cash: w.finance?.cash ?? null,
      staffCost: w.staff.costPerWeek,
      lastWeekResult: w.finance ? w.finance.lastIncome - w.finance.lastCosts : null,
      trainerLevel: w.staff.trainerLevel,
      assistants: w.staff.assistants,
      intensity: w.training.intensity,
      staminaShare: w.training.staminaShare,
      leaguePosition: w.team.leaguePosition || null,
      spirit: w.team.spirit,
      confidence: w.team.confidence,
      tsiSum: w.squad.reduce((s, p) => s + p.tsi, 0),
      wageSum: w.squad.reduce((s, p) => s + p.salary, 0),
      skillUps: ch ? ch.reduce((s, u) => s + Math.max(0, u.to - u.from), 0) : null,
      skillDowns: ch ? ch.reduce((s, u) => s + Math.max(0, u.from - u.to), 0) : null,
    };
  });
}

/** Archiv als CSV (eine Zeile je Woche) für Excel */
export function archiveCsv(weeks: WeekSnapshot[]): string {
  const m = weekMetrics(weeks);
  const head = ["Woche", "Saison", "Spieltag", "Trainingsart", "Intensität %", "Kondition %", "Trainer", "Assistenten", "Personal €/Woche", "Kontostand €", "Vorwoche Saldo €", "Platz", "Stimmung", "Selbstvertrauen", "TSI Summe", "Gehälter €/Woche", "Aufstiege", "Notiz"];
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = weeks.map((w, i) =>
    [w.week, w.season, w.round, w.training.typeName, w.training.intensity, w.training.staminaShare, w.staff.trainerLevel, w.staff.assistants, m[i].staffCost, m[i].cash, m[i].lastWeekResult, m[i].leaguePosition, w.team.spirit, w.team.confidence, m[i].tsiSum, m[i].wageSum, m[i].skillUps, w.note ?? ""]
      .map(q)
      .join(";"),
  );
  return "﻿" + [head.join(";"), ...rows].join("\r\n");
}
