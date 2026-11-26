import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { Location, Tactic, defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { expectedGoalDiff, fitLineup, opponentObjective } from "../src/core/opponentfit";
import { planMatch } from "../src/core/matchplan";
import { TRAININGS } from "../src/core/training";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const settings = { ...defaultMatchSettings, location: Location.home, tactic: Tactic.normal };
const R = (m: number, dl: number, dc: number, dr: number, al: number, ac: number, ar: number) => ({ midfield: m, defenceLeft: dl, defenceCentral: dc, defenceRight: dr, attackLeft: al, attackCentral: ac, attackRight: ar });
const flat = (x: number) => R(x, x, x, x, x, x, x);

describe("Aufstellung gegen den Gegner", () => {
  it("Tordifferenz-Näherung: gleich stark = 0, stärker = positiv", () => {
    expect(expectedGoalDiff(flat(6), flat(6))).toBeCloseTo(0);
    expect(expectedGoalDiff(flat(8), flat(6))).toBeGreaterThan(0);
  });
  it("gewichtet die knappen Duelle am höchsten (dort bringt eine Stufe am meisten)", () => {
    // unser Angriff links trifft auf seine Abwehr rechts (gleich stark), rechts auf seine starke Abwehr links
    const w = opponentObjective(flat(6), R(6, 9, 9, 6, 6, 6, 6)).weights;
    expect(w.attackLeft).toBeGreaterThan(w.attackRight);
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(9);
  });
  it("findet eine Elf, die gegen den Gegner mindestens so gut ist wie die stärkste nach HatStats", () => {
    const opp = { ratings: R(5, 7, 7, 3.5, 5, 6, 5), tactic: Tactic.normal, level: 8 };
    const opt = { formationExperience: hrf.team.formationExperience, minExperience: 6, allowBruised: true, styleRange: [-10, 10] as [number, number], training: TRAININGS[hrf.team.trainingType] };
    const t0 = Date.now();
    const fit = fitLineup(hrf.players, settings, team, opp, opt)!;
    const ms = Date.now() - t0;
    const strongest = optimizeLineup(hrf.players, settings, team, { minFormationExperience: 6, formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, allowBruised: true, tryBehaviours: false });
    const byId = new Map(hrf.players.map((p) => [p.id, p]));
    const base = planMatch(strongest.lineup.positions, byId, settings, team, opp, { styleRange: [-10, 10] });
    console.log(`${fit.candidates.length} Elfen in ${ms} ms; Wahl ${fit.pick.formation} ${fit.pick.plan.best.label} ${fit.pick.plan.best.prediction.points.toFixed(2)} Pkt, ${fit.pick.plan.best.hatStats.toFixed(0)} HS (stärkste ${strongest.lineup.formation} ${base.best.prediction.points.toFixed(2)} Pkt, ${strongest.hatStats.toFixed(0)} HS)`);
    expect(fit.pick.positions).toHaveLength(11);
    expect(fit.pick.plan.best.prediction.points).toBeGreaterThanOrEqual(base.best.prediction.points - 0.03 - 1e-9);
    expect(fit.pick.experience).toBeGreaterThanOrEqual(6);
  });
});
