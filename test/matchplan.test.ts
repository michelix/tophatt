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
});
