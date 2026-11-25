// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Trainingsformationen: die Formationen mit den meisten vollen Trainingsplätzen, je eine für stärkere Gegner
// (Mittelfeld und Abwehr), für ausgeglichene Spiele (stärkste Elf) und für schwächere Gegner (Angriff).

import type { FieldPosition } from "./model";
import type { SectorRatings } from "./rating";
import { type TrainingDef, formationSlots } from "./training";

export type PortfolioRole = "stronger" | "even" | "weaker";
export const ROLE_DE: Record<PortfolioRole, string> = { stronger: "gegen Stärkere", even: "ausgeglichen", weaker: "gegen Schwächere" };

/** Ab dieser Erfahrung droht keine Desorganisation mehr (passabel) */
export const SETTLED_EXPERIENCE = 6;
/** Exotische Formationen kommen nicht ins Portfolio */
const EXOTIC = new Set(["550", "253"]);

export interface PortfolioEntry {
  formation: string;
  role: PortfolioRole;
  hatStats: number;
  experience: number;
  full: number;
  partly: number;
  midfield: number;
  defence: number;
  attack: number;
  positions: FieldPosition[];
}

export const defenceOf = (r: SectorRatings) => r.defenceLeft + r.defenceCentral + r.defenceRight;
export const attackOf = (r: SectorRatings) => r.attackLeft + r.attackCentral + r.attackRight;

/**
 * Portfolio aus den Formationen mit den meisten vollen Trainingsplätzen (bei Gleichstand zählen halbe Plätze nicht):
 * gegen Stärkere die mit dem meisten Mittelfeld und der besten Abwehr im Verhältnis zum Angriff, gegen Schwächere
 * die mit dem stärksten Angriff, ausgeglichen die stärkste übrige Elf (HatStats). Höchstens drei Einträge.
 */
export function trainingPortfolio(
  perFormation: { code: string; hatStats: number; experience: number; positions: FieldPosition[]; ratings: SectorRatings }[],
  t: TrainingDef,
): PortfolioEntry[] {
  const all = perFormation
    .filter((f) => !EXOTIC.has(f.code))
    .map((f) => {
      const s = formationSlots(t, f.code);
      return {
        formation: f.code,
        hatStats: f.hatStats,
        experience: f.experience,
        full: s.full,
        partly: s.partly,
        midfield: f.ratings.midfield,
        defence: defenceOf(f.ratings),
        attack: attackOf(f.ratings),
        positions: f.positions,
      };
    });
  const maxFull = Math.max(0, ...all.map((x) => x.full));
  if (maxFull === 0) return [];
  let pool = all.filter((x) => x.full === maxFull);
  const out: PortfolioEntry[] = [];
  const take = (role: PortfolioRole, score: (x: (typeof pool)[number]) => number) => {
    if (!pool.length) return;
    const pick = [...pool].sort((a, b) => score(b) - score(a) || b.partly - a.partly || b.experience - a.experience)[0];
    pool = pool.filter((x) => x !== pick);
    out.push({ ...pick, role });
  };
  if (pool.length === 1) {
    take("even", (x) => x.hatStats);
    return out;
  }
  take("stronger", (x) => 3 * x.midfield + x.defence - x.attack);
  take("weaker", (x) => x.attack);
  take("even", (x) => x.hatStats);
  const order: PortfolioRole[] = ["stronger", "even", "weaker"];
  return out.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
}
