// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Spielerentwicklung: Trainingszuwachs und altersbedingter Abbau.
// Formeln aus HO (core/training/WeeklyTrainingType.calculateSkillIncreaseOfTrainingWeek und SkillDrops.getSkillDrop),
// beide nach Schum. Ein Hattrick-Jahr hat 112 Tage = 16 Wochen.

import type { Player } from "./model";

export type DevSkill = "keeper" | "defending" | "playmaking" | "winger" | "passing" | "scoring" | "setPieces";
export const DEV_SKILLS: DevSkill[] = ["keeper", "defending", "playmaking", "winger", "passing", "scoring", "setPieces"];
export const DEV_SKILL_DE: Record<DevSkill, string> = {
  keeper: "Torwart",
  defending: "Verteidigung",
  playmaking: "Spielaufbau",
  winger: "Flügelspiel",
  passing: "Passspiel",
  scoring: "Torschuss",
  setPieces: "Standards",
};

/** Trainingsart (HT-Code) -> trainierte Fertigkeit, Grundgeschwindigkeit, Faktor für Osmose (Teiltraining = 0,5) */
const TRAINING_SPEED: Record<number, { skill: DevSkill; koeff: number }> = {
  2: { skill: "setPieces", koeff: 14.7 },
  3: { skill: "defending", koeff: 2.88 },
  4: { skill: "scoring", koeff: 3.24 },
  5: { skill: "winger", koeff: 4.8 },
  6: { skill: "scoring", koeff: 1.5 },
  7: { skill: "passing", koeff: 3.6 },
  8: { skill: "playmaking", koeff: 3.36 },
  9: { skill: "keeper", koeff: 5.1 },
  10: { skill: "passing", koeff: 3.15 },
  11: { skill: "defending", koeff: 1.38 },
  12: { skill: "winger", koeff: 3.12 },
};

const COACH_KOEFF = [0.7343, 0.8324, 0.92, 1, 1.0375]; // Trainer Stufe 4..8

export interface TrainingSetup {
  type: number;
  intensity: number; // 0..100
  staminaShare: number; // 0..100
  coachLevel: number; // 4..8
  assistantsLevel: number; // 0..10
}

export function trainedSkill(type: number): DevSkill | null {
  return TRAINING_SPEED[type]?.skill ?? null;
}

function factorSkillLevel(level: number) {
  return level < 9 ? 16.289 * Math.exp(-0.1396 * level) : 54.676 / level - 1.438;
}

/** Zuwachs in Stufen pro Woche bei vollem Training (share = 1) bzw. Teiltraining (0,5) */
export function weeklyIncrease(level: number, age: number, setup: TrainingSetup, share: number): number {
  const t = TRAINING_SPEED[setup.type];
  if (!t || share <= 0) return 0;
  const coach = COACH_KOEFF[Math.min(4, Math.max(0, Math.round(setup.coachLevel) - 4))];
  const assistants = 1 + Math.min(10, Math.max(0, setup.assistantsLevel)) * 0.035;
  const intensity = setup.intensity / 100;
  const stamina = 1 - setup.staminaShare / 100;
  const ageF = 54 / (age + 37);
  return Math.min(1, t.koeff * share * ageF * assistants * coach * stamina * intensity * factorSkillLevel(Math.floor(level)) * 0.01);
}

const AGE_NO_DROP: Record<DevSkill, number> = { keeper: 29, defending: 28, playmaking: 27, winger: 27, passing: 27, scoring: 26, setPieces: 30 };
const DROP_AGE = [0, 0.0003, 0.0014, 0.0037, 0.0074, 0.0127, 0.0197, 0.0285, 0.0393, 0.0522, 0.0673, 0.0846];

/** Altersabbau in Stufen pro Woche (ohne den Abschlag bei sehr hohen Fertigkeiten, der hier keine Rolle spielt) */
export function weeklyAgeDrop(skill: DevSkill, age: number): number {
  const over = age - AGE_NO_DROP[skill];
  if (over <= 0) return 0;
  return DROP_AGE[Math.min(DROP_AGE.length - 1, over)];
}

/** Ab diesem Alter beginnt der Abbau einer Fertigkeit */
export const dropStartAge = (skill: DevSkill) => AGE_NO_DROP[skill] + 1;

export interface ProjectionPoint {
  week: number;
  age: number;
  ageDays: number;
  values: Record<DevSkill, number>;
}

/**
 * Projektion über `weeks` Wochen. `share` = 1 volles Training, 0,5 Teiltraining, 0 kein Training der Trainingsfertigkeit.
 * Startwerte dürfen Unterstufen enthalten (z. B. 7,3).
 */
export function project(start: Record<DevSkill, number>, age: number, ageDays: number, setup: TrainingSetup, share: number, weeks: number): ProjectionPoint[] {
  const trained = trainedSkill(setup.type);
  const values = { ...start };
  const out: ProjectionPoint[] = [{ week: 0, age, ageDays, values: { ...values } }];
  let a = age,
    d = ageDays;
  for (let w = 1; w <= weeks; w++) {
    d += 7;
    if (d >= 112) {
      a++;
      d -= 112;
    }
    for (const sk of DEV_SKILLS) {
      values[sk] = Math.max(1, values[sk] - weeklyAgeDrop(sk, a));
      if (sk === trained) values[sk] = Math.min(20.99, values[sk] + weeklyIncrease(values[sk], a, setup, share));
    }
    out.push({ week: w, age: a, ageDays: d, values: { ...values } });
  }
  return out;
}

export function skillsOf(p: Player, subs?: Partial<Record<DevSkill, number>>): Record<DevSkill, number> {
  const out = {} as Record<DevSkill, number>;
  for (const sk of DEV_SKILLS) {
    const base = p[sk];
    const fromHistory = subs?.[sk];
    // Unterstufen aus HO nur nehmen, wenn sie zur ganzen Stufe passen
    out[sk] = fromHistory !== undefined && Math.floor(fromHistory) === base ? fromHistory : base + 0.5;
  }
  return out;
}

/** Hauptfertigkeiten eines Spielers (die zwei höchsten, Standards ausgenommen) */
export function mainSkills(p: Player, count = 2): DevSkill[] {
  const ranked = DEV_SKILLS.filter((s) => s !== "setPieces").sort((a, z) => p[z] - p[a]);
  return ranked.slice(0, count);
}

export type Outlook = "wächst" | "stabil" | "Höhepunkt" | "Abbau" | "Ersatz planen";

export interface PlayerOutlook {
  outlook: Outlook;
  mainSkill: DevSkill;
  now: number;
  inOneSeason: number;
  inTwoSeasons: number;
  /** Alter, ab dem die Hauptfertigkeit abnimmt */
  dropAge: number;
  /** Wochen, bis die Hauptfertigkeit (ohne Training) eine ganze Stufe verloren hat; Infinity = nicht innerhalb von 3 Saisons */
  weeksToLoseLevel: number;
  text: string;
}

export function outlookFor(p: Player, start: Record<DevSkill, number>, setup: TrainingSetup, share: number): PlayerOutlook {
  const main = mainSkills(p, 1)[0];
  const proj = project(start, p.age, p.ageDays, setup, share, 48);
  const now = start[main];
  const s1 = proj[16].values[main];
  const s2 = proj[32].values[main];
  // Abbau ohne Training der Hauptfertigkeit
  const noTrain = project(start, p.age, p.ageDays, { ...setup, type: -1 }, 0, 48);
  let weeksToLoseLevel = Infinity;
  for (const pt of noTrain) {
    if (now - pt.values[main] >= 1) {
      weeksToLoseLevel = pt.week;
      break;
    }
  }
  const dropAge = dropStartAge(main);
  let outlook: Outlook;
  let text: string;
  if (s1 - now >= 0.5) {
    outlook = "wächst";
    text = `${DEV_SKILL_DE[main]} steigt mit dem aktuellen Training um etwa ${(s1 - now).toFixed(1)} Stufen pro Saison.`;
  } else if (p.age < dropAge - 1) {
    outlook = "stabil";
    text = `Kein Training auf ${DEV_SKILL_DE[main]}; Abbau beginnt erst mit ${dropAge} Jahren.`;
  } else if (p.age < dropAge) {
    outlook = "Höhepunkt";
    text = `Ab ${dropAge} Jahren baut ${DEV_SKILL_DE[main]} ab. Jetzt ist sein Marktwert am höchsten.`;
  } else if (weeksToLoseLevel > 32) {
    outlook = "Abbau";
    text = `${DEV_SKILL_DE[main]} sinkt langsam, etwa ${(now - s2).toFixed(1)} Stufen in zwei Saisons.`;
  } else {
    outlook = "Ersatz planen";
    text = `${DEV_SKILL_DE[main]} verliert in etwa ${weeksToLoseLevel} Wochen eine ganze Stufe. Nachfolger aufbauen oder kaufen.`;
  }
  return { outlook, mainSkill: main, now, inOneSeason: s1, inTwoSeasons: s2, dropAge, weeksToLoseLevel, text };
}
