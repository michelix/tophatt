// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Trainingsfortschritt der laufenden Saison: welche Trainings gelaufen sind, wer auf einer Trainingsposition
// gespielt hat, welche Stufen gestiegen (oder gesunken) sind und wie viel laut Formel zu erwarten war.
// Quelle: HO-Spielerhistorie (je Download ein Stand), HO-Tabelle TRAINING und die Aufstellungen gespielter Spiele.

import { type DevSkill, DEV_SKILLS, type TrainingSetup, trainedSkill, weeklyIncrease } from "./development";
import type { HoData, TrainingWeek } from "./hodata";
import type { Player } from "./model";
import { TRAININGS, trainingFor } from "./training";

/** Eine Hattrick-Saison hat 16 Trainingswochen */
export const SEASON_WEEKS = 16;
const DAY = 864e5;
const WEEK = 7 * DAY;

export type ProgressSkill = DevSkill | "stamina";
export const PROGRESS_SKILLS: ProgressSkill[] = [...DEV_SKILLS, "stamina"];

export interface SeasonWeek {
  /** 1–16 */
  index: number;
  /** Zeitpunkt des Trainingsupdates (Freitag 00:30 Ortszeit) */
  date: Date;
  /** Trainingsart; bei kommenden Wochen die aktuelle Einstellung */
  type: number;
  intensity: number;
  staminaShare: number;
  coachLevel: number;
  assistantsLevel: number;
  /** Training ist schon gelaufen */
  done: boolean;
  /** Gelaufen, aber vor dem ersten Stand in HO: Aufstiege dieser Woche sind nicht sichtbar */
  beforeHistory: boolean;
}

export interface SkillChange {
  playerId: number;
  skill: ProgressSkill;
  from: number;
  to: number;
  /** Datum des Downloads, in dem die Änderung zuerst auftaucht */
  date: Date;
  /** Trainingswoche (1–16), deren Update die Änderung gebracht hat */
  week: number;
}

export interface PlayerProgress {
  id: number;
  name: string;
  age: number;
  /** Trainingsanteil je Woche: 1 voll, 0,5 halb, 0 nichts; null = Woche noch nicht gelaufen */
  shares: (number | null)[];
  start: Record<ProgressSkill, number>;
  now: Record<ProgressSkill, number>;
  changes: SkillChange[];
  /** Erwarteter Zuwachs in der trainierten Fertigkeit seit dem Startstand (Stufen) */
  expectedGain: number;
  /** Erwarteter Zuwachs je Woche (Index 0 = Woche 1) */
  gainByWeek: number[];
  /** Fortschritt in der aktuellen Stufe der zuletzt trainierten Fertigkeit, Untergrenze 0–1; null = nicht trainiert */
  progress: number | null;
  /** Wochen bis zum nächsten Aufstieg bei gleichem Einsatz; null = ohne Einsatz kein Aufstieg */
  weeksToNext: number | null;
  /** Schätzung setzt vollen Einsatz voraus, weil er bisher nicht auf einer Trainingsposition stand */
  assumesFull: boolean;
}

export interface SeasonProgress {
  season: number;
  weeks: SeasonWeek[];
  /** Stand, mit dem verglichen wird (erster HO-Download vor bzw. in der Saison) */
  startDate: Date;
  /** Letzter Stand */
  nowDate: Date;
  players: PlayerProgress[];
  /** Fertigkeiten, die in dieser Saison trainiert wurden */
  trainedSkills: DevSkill[];
  /** Aufstiege in trainierten Fertigkeiten */
  trainedUps: number;
  /** Laut Formel erwartete Aufstiege (Summe der Zuwächse aller Spieler) */
  expectedUps: number;
  /** Je gelaufener Woche: kumuliert erwartet / tatsächlich (für die Linie) */
  curve: { week: number; expected: number; actual: number }[];
  staminaUp: number;
  staminaDown: number;
}

const r1 = (v: number) => Math.floor(v + 1e-9);

/** Datum des 1. Spieltags der aktuellen Saison (Liga-Spielplan aus HO) */
export function seasonRoundOne(ho: HoData): { season: number; date: Date } | null {
  const season = ho.currentLeague?.season;
  if (!season) return null;
  const first = ho.fixtures.filter((f) => f.season === season && f.round === 1 && !isNaN(f.date.getTime())).sort((a, z) => a.date.getTime() - z.date.getTime())[0];
  return first ? { season, date: first.date } : null;
}

/** Die 16 Trainingsupdates der Saison: jeweils am Freitag vor dem Ligaspieltag um 00:30 */
export function seasonTrainingDates(roundOne: Date, training: TrainingWeek[]): Date[] {
  // HO kennt die echten Zeiten der gelaufenen Trainings; daran ausrichten, sonst Freitag 00:30 vor dem 1. Spieltag
  const guess = new Date(roundOne.getFullYear(), roundOne.getMonth(), roundOne.getDate() - 1, 0, 30);
  const near = training.find((t) => Math.abs(t.date.getTime() - guess.getTime()) < 2 * DAY);
  const first = near ? near.date : guess;
  return Array.from({ length: SEASON_WEEKS }, (_, i) => new Date(first.getTime() + i * WEEK));
}

const skillValue = (o: Record<string, number>, s: ProgressSkill) => r1(o[s] ?? 0);

/**
 * Trainingsfortschritt seit Saisonbeginn.
 * `players` = aktueller Kader (HRF), `current` = aktuelle Trainingseinstellung (für kommende Wochen und Schätzungen).
 */
export function seasonProgress(ho: HoData, players: Player[], current: TrainingSetup, now: Date): SeasonProgress | null {
  const r = seasonRoundOne(ho);
  if (!r) return null;
  const dates = seasonTrainingDates(r.date, ho.training);
  const tol = 2 * DAY;

  // Erster Stand: der letzte Download vor dem ersten Training, sonst der erste in der Saison
  const allDates = [...ho.history.values()].flatMap((l) => l.map((h) => h.date.getTime())).filter((t) => !isNaN(t));
  if (!allDates.length) return null;
  const before = allDates.filter((t) => t < dates[0].getTime());
  const startT = before.length ? Math.max(...before) : Math.min(...allDates.filter((t) => t >= dates[0].getTime()));
  if (!Number.isFinite(startT)) return null;
  const nowT = Math.max(...allDates);

  const weeks: SeasonWeek[] = dates.map((d, i) => {
    const done = d.getTime() <= Math.max(now.getTime(), nowT);
    const t = done ? ho.training.find((x) => Math.abs(x.date.getTime() - d.getTime()) < tol && x.type >= 0) : undefined;
    const base = t ?? { type: current.type, intensity: current.intensity, staminaShare: current.staminaShare, coachLevel: current.coachLevel, assistantsLevel: current.assistantsLevel };
    return {
      index: i + 1,
      date: d,
      type: base.type,
      intensity: base.intensity,
      staminaShare: base.staminaShare,
      coachLevel: base.coachLevel,
      assistantsLevel: base.assistantsLevel,
      done,
      beforeHistory: done && d.getTime() < startT,
    };
  });
  const doneWeeks = weeks.filter((w) => w.done);
  const counted = doneWeeks.filter((w) => !w.beforeHistory);
  const weekOfDate = (t: number) => {
    // Änderung gehört zum letzten Trainingsupdate vor dem Download
    let wk = 0;
    for (const w of weeks) if (w.date.getTime() <= t) wk = w.index;
    return wk;
  };

  // Einsätze: Spiele der Woche vor jedem Update (eigene Aufstellung, nur Spiele mit Training)
  const matchType = new Map(ho.matches.map((m) => [m.id, m.type]));
  const own = ho.lineupPlayers.filter((l) => l.teamId === ho.teamId);
  const shareOf = (playerId: number, w: SeasonWeek): number => {
    const def = TRAININGS[w.type];
    if (!def) return 0;
    const from = w.date.getTime() - WEEK;
    let best = 0;
    for (const l of own) {
      if (l.playerId !== playerId) continue;
      const t = l.date.getTime();
      if (t <= from || t > w.date.getTime()) continue;
      const mt = matchType.get(l.matchId) ?? 1;
      if (mt <= 0 || mt >= 50) continue; // Turniere, Leiter und Einzelspiele zählen nicht
      const lvl = trainingFor(l.roleId, def);
      best = Math.max(best, lvl === "voll" ? 1 : lvl === "teilweise" ? 0.5 : 0);
    }
    return best;
  };

  const trainedSkills = [...new Set(doneWeeks.map((w) => trainedSkill(w.type)).filter((s): s is DevSkill => !!s))];
  const setupOf = (w: SeasonWeek): TrainingSetup => ({ type: w.type, intensity: w.intensity, staminaShare: w.staminaShare, coachLevel: w.coachLevel, assistantsLevel: w.assistantsLevel });

  const list: PlayerProgress[] = [];
  for (const p of players) {
    const hist = (ho.history.get(p.id) ?? []).filter((h) => !isNaN(h.date.getTime()));
    const inSeason = hist.filter((h) => h.date.getTime() >= startT);
    if (!inSeason.length) continue;
    const snaps = inSeason as unknown as Record<string, number>[];
    const start = {} as Record<ProgressSkill, number>;
    const cur = {} as Record<ProgressSkill, number>;
    for (const s of PROGRESS_SKILLS) {
      start[s] = skillValue(snaps[0], s);
      cur[s] = s === "stamina" ? p.stamina : p[s];
    }
    const changes: SkillChange[] = [];
    for (let i = 1; i < inSeason.length; i++) {
      for (const s of PROGRESS_SKILLS) {
        const a = skillValue(snaps[i - 1], s);
        const b = skillValue(snaps[i], s);
        if (a !== b) changes.push({ playerId: p.id, skill: s, from: a, to: b, date: inSeason[i].date, week: weekOfDate(inSeason[i].date.getTime()) });
      }
    }
    // Neuerer HRF-Stand als die HO-Historie
    const last = snaps[snaps.length - 1];
    const lastDate = inSeason[inSeason.length - 1].date;
    for (const s of PROGRESS_SKILLS) {
      const a = skillValue(last, s);
      if (a !== cur[s] && cur[s] > 0) changes.push({ playerId: p.id, skill: s, from: a, to: cur[s], date: new Date(Math.max(lastDate.getTime(), now.getTime())), week: weekOfDate(now.getTime()) });
    }

    const shares = weeks.map((w) => (w.done ? shareOf(p.id, w) : null));
    // Erwarteter Zuwachs je gezählter Woche, Stufe so wie sie in der Woche war
    let expectedGain = 0;
    const gainByWeek = weeks.map(() => 0);
    let sinceUp = 0;
    let level = { ...start };
    for (const w of counted) {
      const sk = trainedSkill(w.type);
      const share = shares[w.index - 1] ?? 0;
      for (const c of changes.filter((c) => c.week === w.index)) level[c.skill] = c.to;
      if (!sk || share <= 0) continue;
      const g = weeklyIncrease(level[sk] + 0.5, p.age, setupOf(w), share);
      expectedGain += g;
      gainByWeek[w.index - 1] = g;
    }
    level = { ...cur };
    const lastTrained = [...counted].reverse().find((w) => trainedSkill(w.type));
    const sk = lastTrained ? trainedSkill(lastTrained.type) : trainedSkill(current.type);
    let progress: number | null = null;
    let weeksToNext: number | null = null;
    let assumesFull = false;
    if (sk) {
      const ups = changes.filter((c) => c.skill === sk && c.to > c.from);
      const lastUp = ups.length ? ups[ups.length - 1].week : 0;
      for (const w of counted) {
        if (trainedSkill(w.type) !== sk || w.index <= lastUp) continue;
        const share = shares[w.index - 1] ?? 0;
        if (share > 0) sinceUp += weeklyIncrease(level[sk] + 0.5, p.age, setupOf(w), share);
      }
      const hoSub = (last[sk] ?? 0) - r1(last[sk] ?? 0);
      const trainedAny = shares.some((s) => (s ?? 0) > 0);
      if (trainedAny || ups.length) progress = Math.min(0.99, Math.max(sinceUp, skillValue(last, sk) === cur[sk] ? hoSub : 0));
      const used = counted.map((w) => shares[w.index - 1] ?? 0);
      const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
      const share = avg > 0 ? avg : 1;
      assumesFull = avg <= 0;
      const inc = weeklyIncrease(cur[sk] + 0.5, p.age, current, share);
      if (inc > 0) weeksToNext = Math.max(1, Math.ceil((1 - (progress ?? 0)) / inc));
    }
    list.push({ id: p.id, name: p.name, age: p.age, shares, start, now: cur, changes, expectedGain, gainByWeek, progress, weeksToNext, assumesFull });
  }

  const isTrainedUp = (c: SkillChange) => c.to > c.from && trainedSkills.includes(c.skill as DevSkill) && trainedSkill(weeks[c.week - 1]?.type ?? -1) === c.skill;
  const allChanges = list.flatMap((p) => p.changes);
  const curve = [{ week: counted.length ? counted[0].index - 1 : 0, expected: 0, actual: 0 }];
  let exp = 0;
  for (const w of counted) {
    for (const p of list) exp += p.gainByWeek[w.index - 1];
    curve.push({ week: w.index, expected: exp, actual: allChanges.filter((c) => c.week <= w.index && isTrainedUp(c)).reduce((a, c) => a + (c.to - c.from), 0) });
  }
  return {
    season: r.season,
    weeks,
    startDate: new Date(startT),
    nowDate: new Date(Math.max(nowT, now.getTime())),
    players: list,
    trainedSkills,
    trainedUps: allChanges.filter(isTrainedUp).reduce((a, c) => a + (c.to - c.from), 0),
    expectedUps: list.reduce((a, p) => a + p.expectedGain, 0),
    curve,
    staminaUp: allChanges.filter((c) => c.skill === "stamina" && c.to > c.from).reduce((a, c) => a + (c.to - c.from), 0),
    staminaDown: allChanges.filter((c) => c.skill === "stamina" && c.to < c.from).reduce((a, c) => a + (c.from - c.to), 0),
  };
}
