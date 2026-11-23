import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { predict } from "../src/core/matchplan";
import { Role, Specialty, Tactic } from "../src/core/model";
import { tacticLevel } from "../src/core/tactics";
import { loyaltyBonus, skillRating, strength } from "../src/core/rating";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const roles = [Role.keeper, Role.rightBack, Role.rightCentralDefender, Role.leftCentralDefender, Role.leftBack, Role.rightWinger, Role.centralInnerMidfield, Role.leftInnerMidfield, Role.leftWinger, Role.rightForward, Role.centralForward];
const field = hrf.players.filter((p) => p.injury < 0).slice(0, 11).map((player, i) => ({ player, role: roles[i] }));
const r = (x: number) => ({ midfield: x, defenceLeft: x, defenceCentral: x, defenceRight: x, attackLeft: x, attackCentral: x, attackRight: x });

describe("Pressing (#56)", () => {
  it("Pressingstärke wie HO calcPressing: 0,085 · Σ Taktikstärke Verteidigung + 0,075", () => {
    const hand = field.reduce((s, { player: p }) => {
      const xp = skillRating(p.experience);
      let d = loyaltyBonus(p) + strength(p, "defending") + (xp > 0 ? (Math.log10(xp) * 4) / 3 : 0);
      if (d > 0 && p.specialty === Specialty.Powerful) d *= 2;
      return s + d;
    }, 0);
    expect(tacticLevel(field, Tactic.pressing)).toBeCloseTo(0.085 * hand + 0.075, 9);
  });

  it("durchsetzungsstarke Spieler zählen doppelt", () => {
    const base = tacticLevel(field, Tactic.pressing)!;
    const p = { ...field[1].player, specialty: Specialty.Powerful };
    const f2 = field.map((x, i) => (i === 1 ? { ...x, player: p } : x));
    expect(tacticLevel(f2, Tactic.pressing)!).toBeGreaterThan(base);
  });

  it("unter Stärke 5 wirkt Pressing nicht, darüber fallen Angriffe weg (weniger Tore auf beiden Seiten)", () => {
    const normal = predict({ ratings: r(6), tactic: Tactic.normal, level: null }, { ratings: r(6), tactic: Tactic.normal, level: null }, 20000);
    const weak = predict({ ratings: r(6), tactic: Tactic.pressing, level: 4.9 }, { ratings: r(6), tactic: Tactic.normal, level: null }, 20000);
    expect(weak.goalsFor).toBeCloseTo(normal.goalsFor, 6);
    const strong = predict({ ratings: r(6), tactic: Tactic.pressing, level: 9 }, { ratings: r(6), tactic: Tactic.normal, level: null }, 20000);
    expect(strong.goalsFor).toBeLessThan(normal.goalsFor * 0.85);
    expect(strong.goalsAgainst).toBeLessThan(normal.goalsAgainst * 0.85);
    expect(strong.draw).toBeGreaterThan(normal.draw);
  });

  it("als Außenseiter macht starkes Pressing das Spiel enger", () => {
    const opp = { ratings: r(8), tactic: Tactic.normal, level: null };
    const normal = predict({ ratings: r(6), tactic: Tactic.normal, level: null }, opp, 20000);
    const press = predict({ ratings: r(6), tactic: Tactic.pressing, level: 10 }, opp, 20000);
    expect(press.loss).toBeLessThan(normal.loss);
  });
});
