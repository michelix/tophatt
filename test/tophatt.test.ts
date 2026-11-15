import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHoData, standings, upcomingMatches, roundOf } from "../src/core/hodata";
import { project, weeklyIncrease, weeklyAgeDrop, outlookFor, skillsOf } from "../src/core/development";
import { parseHrf } from "../src/core/hrf";
import { defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { assessSectors } from "../src/core/weakness";
import { duels, htToLevel, opponentProfile, verdict } from "../src/core/opponent";
import { planSquad, squadGroups, staminaShare } from "../src/core/squad";
import { completeLineup, evaluatePositions, explain, formationCode, lineupProblems } from "../src/core/editor";
import { budget, searchProfiles } from "../src/core/scouting";

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

describe("Gegner, Kaderplanung, Suchprofil", () => {
  const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
  const L = optimizeLineup(hrf.players, defaultMatchSettings, team, {
    minFormationExperience: 0,
    formationExperience: hrf.team.formationExperience,
    objective: HATSTATS_OBJECTIVE,
    allowBruised: false,
    tryBehaviours: false,
  });
  const setup = { type: hrf.team.trainingType, intensity: 100, staminaShare: 15, coachLevel: 6, assistantsLevel: 1 };
  const plans = planSquad(hrf.players, L.lineup, (p) => project(skillsOf(p), p.age, p.ageDays, setup, 0, 32));

  it("liest die Spielbewertungen aus HO und mittelt die Pflichtspiele des Gegners", () => {
    expect(ho.matchRatings.length).toBeGreaterThan(10);
    expect(htToLevel(1)).toBe(1);
    expect(htToLevel(17)).toBe(5);
    const opp = opponentProfile(ho.matchRatings, 700203)!;
    expect(opp.matches.length).toBe(5);
    expect(opp.matches.every((m) => [1, 2, 3].includes(m.type))).toBe(true);
    expect(opp.formation).toMatch(/^\d-\d-\d$/);
    expect(opponentProfile(ho.matchRatings, 1)).toBeNull();
  });
  it("Duelle: unser rechter Angriff gegen ihre linke Abwehr, Einschätzung symmetrisch", () => {
    const opp = opponentProfile(ho.matchRatings, 700203)!;
    const d = duels(L.ratings, opp.average);
    expect(d).toHaveLength(7);
    expect(d[1].ours).toBe(L.ratings.attackRight);
    expect(d[1].theirs).toBe(opp.average.defenceLeft);
    expect(verdict(duels(L.ratings, L.ratings)).text).toBe("ausgeglichen");
    expect(verdict(d).edge).toBeLessThan(0.5);
  });
  it("Kaderplanung: Stammplätze laut Formation, drei Zeitpunkte, Spieler nur einmal Stammspieler", () => {
    expect(plans.reduce((s, g) => s + g.needed, 0)).toBe(11);
    for (const g of plans) {
      expect(g.horizons).toHaveLength(3);
      expect(g.horizons[0].starters).toHaveLength(g.needed);
    }
    const ids = plans.flatMap((g) => g.horizons[0].starters.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(plans.find((g) => g.group === "goal")!.horizons[2].starters[0].age).toBe(plans.find((g) => g.group === "goal")!.horizons[0].starters[0].age + 2);
  });
  it("Kaderplanung erkennt eine Lücke, wenn der einzige Torwart altert", () => {
    const old = hrf.players.map((p) => (p.keeper >= 6 ? { ...p, age: 34 } : p));
    const pl = planSquad(old, L.lineup, (p) => project(skillsOf(p), p.age, p.ageDays, setup, 0, 32));
    expect(pl.find((g) => g.group === "goal")!.severity).not.toBe("good");
  });
  it("Suchprofil für schwache Mannschaftsteile mit Zielwerten über den Stammspielern", () => {
    const weak = assessSectors(hrf.players, L.lineup, L.ratings, defaultMatchSettings, team);
    const prof = searchProfiles(hrf.players, weak, plans);
    expect(prof.length).toBeGreaterThan(0);
    const mid = prof.find((p) => p.group === "innerMidfield")!;
    expect(mid.kind).toBe("sofort");
    expect(mid.age).toEqual([27, 30]);
    const starters = plans.find((g) => g.group === "innerMidfield")!.horizons[0].starters.map((e) => hrf.players.find((p) => p.id === e.id)!);
    expect(mid.skills[0].min).toBeGreaterThanOrEqual(Math.min(...starters.map((p) => p.playmaking)) + 2);
    expect(budget(hrf.players, 100000).available).toBeLessThan(100000);
  });
});

describe("Kader-Gruppen und Aufstellungs-Editor", () => {
  const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
  const L = optimizeLineup(hrf.players, defaultMatchSettings, team, {
    minFormationExperience: 0,
    formationExperience: hrf.team.formationExperience,
    objective: HATSTATS_OBJECTIVE,
    allowBruised: true,
    tryBehaviours: false,
  });
  const byId = new Map(hrf.players.map((p) => [p.id, p]));

  it("Gruppen: jeder Spieler hat eine Heimgruppe, Verletzte haben Einsatzwert 0", () => {
    const G = squadGroups(hrf.players);
    expect(G).toHaveLength(6);
    const homes = G.flatMap((g) => g.members.filter((m) => m.home).map((m) => m.player.id));
    expect(new Set(homes).size).toBe(hrf.players.length);
    for (const m of G.flatMap((g) => g.members)) {
      if (m.player.injury > 0) expect(m.score).toBe(0);
      expect(m.share).toBeLessThanOrEqual(1);
    }
    expect(staminaShare(8)).toBeGreaterThan(staminaShare(4));
  });
  it("Editor: gleiche Aufstellung ergibt gleiche Bewertung und keine Änderungen", () => {
    const mine = evaluatePositions(L.lineup.positions, byId, defaultMatchSettings, team);
    expect(mine.hatStats).toBeCloseTo(L.hatStats, 5);
    expect(formationCode(L.lineup.positions)).toBe(L.lineup.formation);
    const E = explain({ positions: L.lineup.positions, ...mine }, { positions: L.lineup.positions, ...mine }, hrf.players, hrf.team.formationExperience);
    expect(E.same).toBe(true);
  });
  it("Editor: Spieler herausnehmen senkt die Bewertung und wird erklärt", () => {
    const auto = { positions: L.lineup.positions, ratings: L.ratings, hatStats: L.hatStats };
    const pos = L.lineup.positions.filter((p) => p.role !== L.lineup.positions.find((x) => x.role >= 107 && x.role <= 109)!.role);
    const mine = { positions: pos, ...evaluatePositions(pos, byId, defaultMatchSettings, team) };
    const E = explain(auto, mine, hrf.players, hrf.team.formationExperience);
    expect(E.same).toBe(false);
    expect(E.hatStatsMine).toBeLessThan(E.hatStatsAuto);
    expect(E.sectors.find((s) => s.sector === "midfield")!.delta).toBeLessThan(0);
    expect(E.changes.some((c) => c.includes("sitzt draußen"))).toBe(true);
    expect(E.warnings.some((w) => w.includes("10 von 11"))).toBe(true);
    expect(lineupProblems(pos, byId).length).toBeGreaterThan(0);
  });
  it("Editor: fertige Aufstellung hat Kapitän, Standards und Bank ohne Feldspieler", () => {
    const C = completeLineup(L.lineup.positions, hrf.players, defaultMatchSettings, true);
    const field = new Set(L.lineup.positions.map((p) => p.playerId));
    expect(field.has(C.captainId)).toBe(true);
    expect(field.has(C.setPiecesId)).toBe(true);
    for (const id of Object.values(C.bench)) expect(field.has(id!)).toBe(false);
  });
});
