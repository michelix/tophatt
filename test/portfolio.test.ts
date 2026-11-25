import { describe, expect, it } from "vitest";
import type { SectorRatings } from "../src/core/rating";
import { TRAININGS } from "../src/core/training";
import { trainingPortfolio } from "../src/core/portfolio";

const r = (midfield: number, d: number, a: number): SectorRatings => ({ midfield, defenceLeft: d, defenceCentral: d, defenceRight: d, attackLeft: a, attackCentral: a, attackRight: a });
// Werte wie mit den echten Daten vom 25.11. (Spielaufbau)
const per = [
  { code: "451", hatStats: 200.1, experience: 3, ratings: r(5.06, 6.97, 4.67) },
  { code: "352", hatStats: 205.0, experience: 6, ratings: r(4.99, 6.27, 5.83) },
  { code: "433", hatStats: 203.3, experience: 8, ratings: r(3.86, 6.83, 6.23) },
  { code: "532", hatStats: 200.3, experience: 3, ratings: r(3.94, 7.47, 5.3) },
  { code: "442", hatStats: 205.5, experience: 10, ratings: r(4.78, 6.83, 5.5) },
  { code: "343", hatStats: 207.5, experience: 3, ratings: r(4.67, 6.13, 6.5) },
  { code: "253", hatStats: 195.9, experience: 3, ratings: r(5.0, 5.33, 6.0) },
  { code: "550", hatStats: 190, experience: 3, ratings: r(6, 8, 0.5) },
].map((x) => ({ ...x, positions: [] }));

describe("Trainingsformationen", () => {
  it("Spielaufbau: 4-5-1 gegen Stärkere, 3-5-2 ausgeglichen, 4-3-3 gegen Schwächere", () => {
    const p = trainingPortfolio(per, TRAININGS[8]);
    expect(p.map((x) => [x.role, x.formation])).toEqual([
      ["stronger", "451"],
      ["even", "352"],
      ["weaker", "433"],
    ]);
    expect(p.every((x) => x.full === 3)).toBe(true);
  });
  it("nur eine Formation mit den meisten Plätzen: ausgeglichen", () => {
    const p = trainingPortfolio(per.filter((x) => ["442", "352", "343"].includes(x.code)), TRAININGS[8]);
    expect(p.map((x) => [x.role, x.formation])).toEqual([["even", "352"]]);
  });
});
