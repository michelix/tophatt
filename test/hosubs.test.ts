import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { type HoData, type SkillSnapshot, applyHoSubskills } from "../src/core/hodata";
import { Location, defaultMatchSettings } from "../src/core/model";
import { averageRatings, hatStats, strength } from "../src/core/rating";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { lineupField } from "../src/core/rating";

const load = () => parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const at = (s: string) => new Date(s.replace(" ", "T"));

/** HO-Stand mit denselben ganzen Stufen wie die HRF, plus Unterstufen */
function hoFor(players: ReturnType<typeof load>["players"], date: string, formSub: number, skillSub = 0): HoData {
  const history = new Map<number, SkillSnapshot[]>();
  for (const p of players) {
    history.set(p.id, [
      { date: at(date), age: p.age, ageDays: p.ageDays, keeper: p.keeper + skillSub, defending: p.defending + skillSub, playmaking: p.playmaking + skillSub, winger: p.winger + skillSub, passing: p.passing + skillSub, scoring: p.scoring + skillSub, setPieces: p.setPieces + skillSub, form: p.form, formSub, stamina: p.stamina, tsi: p.tsi },
    ]);
  }
  return { history } as unknown as HoData;
}

describe("Unterstufen aus HO (#54)", () => {
  it("übernimmt Form- und Fähigkeits-Unterstufen aus HOs Stand zur selben HRF", () => {
    const hrf = load();
    const ho = hoFor(hrf.players, hrf.team.hrfDate, 0, 0.4);
    expect(applyHoSubskills(hrf.players, ho, hrf.team.hrfDate)).toBe(hrf.players.length);
    const p = hrf.players[0];
    expect(p.formSub).toBe(0);
    expect(p.subs?.defending).toBeCloseTo(0.4, 9);
  });

  it("lässt alles unverändert ohne HO-Daten oder bei einem Stand von einem anderen Tag", () => {
    const hrf = load();
    expect(applyHoSubskills(hrf.players, null, hrf.team.hrfDate)).toBe(0);
    expect(applyHoSubskills(hrf.players, hoFor(hrf.players, "2026-11-10 08:00:00", 0), hrf.team.hrfDate)).toBe(0);
    expect(hrf.players.every((p) => p.formSub === 0.5 && !p.subs)).toBe(true);
  });

  it("nimmt keine Unterstufe, wenn HO eine andere ganze Stufe kennt", () => {
    const hrf = load();
    const ho = hoFor(hrf.players, hrf.team.hrfDate, 0.3, 0.6);
    const p = hrf.players[0];
    ho.history.get(p.id)![0].defending = p.defending + 1.6;
    applyHoSubskills(hrf.players, ho, hrf.team.hrfDate);
    expect(p.subs?.defending).toBeUndefined();
    expect(p.subs?.playmaking).toBeCloseTo(0.6, 9);
  });

  it("Unterstufen zählen in der Stärke wie bei HO (getSkill = Stufe + Unterstufe)", () => {
    const hrf = load();
    const p = hrf.players.find((x) => x.defending > 2)!;
    const before = strength(p, "defending");
    p.subs = { defending: 0.5 };
    expect(strength(p, "defending")).toBeGreaterThan(before);
  });

  it("mit HOs Form-Unterstufe 0 (nach HRF-Import) liegen die HatStats rund 4 % unter der Schätzung mit 0,5", () => {
    const hrf = load();
    const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
    const m = { ...defaultMatchSettings, location: Location.home };
    const best = optimizeLineup(hrf.players, m, team, { formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, tryBehaviours: false, minFormationExperience: 6, allowBruised: false });
    const byId = new Map(hrf.players.map((p) => [p.id, p]));
    const est = hatStats(averageRatings(lineupField(best.lineup, byId), m, team));
    applyHoSubskills(hrf.players, hoFor(hrf.players, hrf.team.hrfDate, 0), hrf.team.hrfDate);
    const ho = hatStats(averageRatings(lineupField(best.lineup, byId), m, team));
    expect(est / ho - 1).toBeGreaterThan(0.03);
    expect(est / ho - 1).toBeLessThan(0.07);
  });
});
