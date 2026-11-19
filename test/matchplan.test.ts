import { describe, expect, it } from "vitest";
import { effectiveness, predict } from "../src/core/matchplan";
import { Tactic } from "../src/core/model";

const r = (x: number) => ({ midfield: x, defenceLeft: x, defenceCentral: x, defenceRight: x, attackLeft: x, attackCentral: x, attackRight: x });

describe("Spielvorhersage", () => {
  it("effectiveness ist bei Gleichstand 50 und symmetrisch", () => {
    expect(effectiveness(0.5)).toBeCloseTo(50);
    expect(effectiveness(0.7) + effectiveness(0.3)).toBeCloseTo(100);
  });
  it("gleich starke Teams sind ausgeglichen", () => {
    const p = predict({ ratings: r(6), tactic: Tactic.normal, level: null }, { ratings: r(6), tactic: Tactic.normal, level: null });
    expect(Math.abs(p.win - p.loss)).toBeLessThan(0.05);
    expect(p.win + p.draw + p.loss).toBeCloseTo(1);
  });
  it("das stärkere Team gewinnt meistens", () => {
    const p = predict({ ratings: r(9), tactic: Tactic.normal, level: null }, { ratings: r(5), tactic: Tactic.normal, level: null });
    expect(p.win).toBeGreaterThan(0.8);
    expect(p.goalsFor).toBeGreaterThan(p.goalsAgainst);
  });
  it("stimmt mit HOs Simulation überein (Hartplatz gegen BF, HO: 88 % / 9 % / 2 %, mit Kontern gleich)", () => {
    const R = (m: number, dl: number, dc: number, dr: number, al: number, ac: number, ar: number) => ({ midfield: m, defenceLeft: dl, defenceCentral: dc, defenceRight: dr, attackLeft: al, attackCentral: ac, attackRight: ar });
    const hart = R(7.75, 8.25, 9.25, 8.25, 5.5, 4.75, 5.5);
    const bf = R(4.0, 7.25, 6.75, 6.75, 5.0, 5.5, 6.75);
    for (const [tactic, level] of [[Tactic.normal, null], [Tactic.counter, 6]] as const) {
      const p = predict({ ratings: hart, tactic: Tactic.normal, level: null }, { ratings: bf, tactic, level }, 20000);
      expect(p.win).toBeCloseTo(0.88, 1);
      expect(p.draw).toBeCloseTo(0.09, 1);
      expect(p.loss).toBeLessThan(0.04);
    }
  });
});

import { styleRange } from "../src/core/model";
describe("Ausrichtung je Trainer (wie HO)", () => {
  it("ausgeglichener Trainer ohne Taktik-Assistenten: nur ausgewogen", () => expect(styleRange({ trainerType: 2, tacticalAssistants: 0 })).toEqual([0, 0]));
  it("ausgeglichener Trainer mit Stufe 5: -5 … 5", () => expect(styleRange({ trainerType: 2, tacticalAssistants: 5 })).toEqual([-5, 5]));
  it("defensiver Trainer mit Stufe 2: -10 … -6", () => expect(styleRange({ trainerType: 0, tacticalAssistants: 2 })).toEqual([-10, -6]));
  it("offensiver Trainer mit Stufe 5: 0 … 10", () => expect(styleRange({ trainerType: 1, tacticalAssistants: 5 })).toEqual([0, 10]));
});
