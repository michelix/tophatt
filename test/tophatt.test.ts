import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHoData, standings, upcomingMatches, roundOf } from "../src/core/hodata";
import { project, weeklyIncrease, weeklyAgeDrop, outlookFor, skillsOf } from "../src/core/development";
import { parseHrf } from "../src/core/hrf";
import { defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { assessSectors } from "../src/core/weakness";

const ho = parseHoData(readFileSync("test/fixtures/tophatt-data.json", "utf8"));
const hrf = parseHrf(readFileSync("test/fixtures/team.hrf", "utf8"));

describe("HO-Daten", () => {
  it("findet das nächste Ligaspiel und den Spielplan", () => {
    const up = upcomingMatches(ho, new Date("2026-11-18T12:00:00"));
    expect(up[0].awayId === ho.teamId || up[0].homeId === ho.teamId).toBe(true);
    expect(up[0].homeName).toBe("SV Bach");
    expect(roundOf(ho, up[0].id)).toBe(2);
    expect(ho.currentLeague?.name).toBe("VII.1");
  });
  it("rechnet die Tabelle", () => {
    const t = standings(ho);
    expect(t).toHaveLength(8);
    const me = t.find((r) => r.teamId === ho.teamId)!;
    expect(me.points).toBe(3);
    expect(me.goalsFor).toBe(3);
  });
  it("hat die Spielerhistorie mit Unterstufen", () => {
    const h = ho.history.get(700049)!;
    expect(h.length).toBeGreaterThanOrEqual(2);
    expect(Math.floor(h[0].keeper)).toBe(6);
  });
});

describe("Entwicklung", () => {
  const setup = { type: 3, intensity: 100, staminaShare: 15, coachLevel: 6, assistantsLevel: 1 };
  it("Training: jung schneller als alt, niedrige Stufe schneller als hohe", () => {
    expect(weeklyIncrease(7, 18, setup, 1)).toBeGreaterThan(weeklyIncrease(7, 30, setup, 1));
    expect(weeklyIncrease(5, 20, setup, 1)).toBeGreaterThan(weeklyIncrease(9, 20, setup, 1));
    expect(weeklyIncrease(7, 18, setup, 1)).toBeCloseTo(0.14, 1);
  });
  it("Abbau beginnt nach dem Grenzalter", () => {
    expect(weeklyAgeDrop("scoring", 26)).toBe(0);
    expect(weeklyAgeDrop("scoring", 30)).toBeGreaterThan(0);
    expect(weeklyAgeDrop("keeper", 29)).toBe(0);
  });
  it("Projektion: 16 Wochen = ein Jahr älter", () => {
    const p = hrf.players.find((x) => x.name.includes("Esche"))!;
    const pr = project(skillsOf(p), p.age, p.ageDays, setup, 1, 16);
    expect(pr[16].age).toBe(p.age + 1);
    expect(pr[16].values.defending).toBeGreaterThan(pr[0].values.defending);
  });
  it("älterer Stürmer ohne Training: Ersatz planen", () => {
    const p = hrf.players.find((x) => x.name.includes("Hasel"))!;
    expect(outlookFor(p, skillsOf(p), setup, 0).outlook).toBe("Ersatz planen");
  });
});

describe("Schwachstellen", () => {
  it("markiert das Mittelfeld", () => {
    const s = { ...defaultMatchSettings, location: 1 } as typeof defaultMatchSettings;
    const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
    const r = optimizeLineup(hrf.players, s, team, { minFormationExperience: 6, formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, allowBruised: true, tryBehaviours: false });
    const w = assessSectors(hrf.players, r.lineup, r.ratings, s, team);
    expect(w.find((x) => x.sector === "midfield")!.severity).toBe("critical");
    expect(w.find((x) => x.sector === "midfield")!.lever).not.toBeNull();
  });
});
