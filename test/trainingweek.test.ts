import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { Location, Tactic, defaultMatchSettings } from "../src/core/model";
import { FORMATIONS, HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { TRAININGS, addPlanned, planFriendly, trainingFor, trainingPriority, weekFactor } from "../src/core/training";
import { chooseLeagueFormation, forgotten, planCup, suggestSquads, weekRows } from "../src/core/trainingweek";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const settings = { ...defaultMatchSettings, location: Location.home, tactic: Tactic.normal };
const T = hrf.team.trainingType; // Testdaten: Verteidigung
const t = TRAININGS[T];
const byName = (n: string) => hrf.players.find((p) => p.name === n)!;
const perFormation = FORMATIONS.map((f) => {
  const r = optimizeLineup(hrf.players, settings, team, { formations: [f], minFormationExperience: 0, formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, allowBruised: false, tryBehaviours: false });
  return { code: f, hatStats: r.hatStats, experience: hrf.team.formationExperience[f] ?? 0, positions: r.lineup.positions };
});

describe("Trainingswoche", () => {
  it("liest die Trainingsart aus den Daten", () => {
    expect(t.name).toBe("Verteidigung");
  });

  it("Trainingsnutzen: jünger und niedrigere Fertigkeit zuerst", () => {
    const p = { ...byName("Emil Fichte"), keeper: 1, playmaking: 1, winger: 1, scoring: 1, passing: 1, defending: 6 };
    expect(trainingPriority({ ...p, age: 18 }, t)).toBeGreaterThan(trainingPriority({ ...p, age: 27 }, t));
    expect(trainingPriority({ ...p, defending: 5 }, t)).toBeGreaterThan(trainingPriority({ ...p, defending: 10 }, t));
  });

  it("Liga: unter fast gleich starken Formationen die mit mehr Trainingsplätzen", () => {
    const c = chooseLeagueFormation(perFormation, t, 0)!;
    expect(c.best.formation).toBe("352");
    expect(c.pick.formation).toBe("442");
    expect(c.pick.full).toBeGreaterThan(c.best.full);
    expect(c.pick.hatStats).toBeGreaterThanOrEqual(c.best.hatStats * 0.98);
    expect(c.reason).toContain("Trainingsplätze");
    // nur erfahrene Formationen
    const exp = chooseLeagueFormation(perFormation, t, 6)!;
    expect(["442", "433"]).toContain(exp.pick.formation);
  });

  it("Kader: A = Ligaelf, B = 11 weitere mit einem Torwart, eigene Zuordnung geht vor", () => {
    const league = chooseLeagueFormation(perFormation, t, 0)!.pick.positions.map((p) => p.playerId);
    const s = suggestSquads(hrf.players, league, t);
    expect([...s.values()].filter((x) => x === "A")).toHaveLength(11);
    const b = [...s].filter(([, x]) => x === "B").map(([id]) => hrf.players.find((p) => p.id === id)!);
    expect(b.length).toBeLessThanOrEqual(11);
    expect(b.filter((p) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing))).toHaveLength(1);
    const own = suggestSquads(hrf.players, league, t, { [byName("Simon Kastanie").id]: "R" });
    expect(own.get(byName("Simon Kastanie").id)).toBe("R");
  });

  it("Freundschaftsspiel: die Jungen mit dem größten Nutzen bekommen die Trainingsplätze", () => {
    const league = perFormation.find((f) => f.code === "442")!.positions;
    const f = planFriendly(hrf.players, { positions: league }, T, false, new Map(), hrf.team.formationExperience);
    const trained = f.lineup.positions.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId);
    const inLeague = new Set(league.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId));
    const keeperType = (p: (typeof hrf.players)[number]) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);
    const expected = hrf.players
      .filter((p) => p.injury < 0 && p.cards < 3 && !inLeague.has(p.id) && !keeperType(p))
      .sort((a, b) => trainingPriority(b, t) - trainingPriority(a, t))
      .slice(0, trained.length)
      .map((p) => p.id);
    expect([...trained].sort()).toEqual([...expected].sort());
  });

  it("Pokal: drei Varianten, Empfehlung mit Begründung", () => {
    const before = addPlanned(new Map(), perFormation.find((f) => f.code === "442")!.positions, t, "Liga");
    const opp = { ratings: perFormation[0] && optimizeLineup(hrf.players, settings, team, { minFormationExperience: 0, formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, allowBruised: false, tryBehaviours: false }).ratings, tactic: 0, level: null };
    const plan = planCup(hrf.players, T, before, settings, team, { formationExperience: hrf.team.formationExperience, minExperience: 0, allowBruised: false, opponent: opp });
    expect(plan.variants[0].key).toBe("strong");
    expect(plan.variants.at(-1)!.key).toBe("training");
    expect(plan.variants.every((v) => v.win !== null && v.positions.length === 11)).toBe(true);
    expect(plan.reason.length).toBeGreaterThan(10);
    // chancenloser Gegner → reine Trainingself
    const strongOpp = { ...opp, ratings: Object.fromEntries(Object.entries(opp.ratings).map(([k, v]) => [k, (v as number) * 2.2])) as typeof opp.ratings };
    expect(planCup(hrf.players, T, before, settings, team, { formationExperience: hrf.team.formationExperience, minExperience: 0, allowBruised: false, opponent: strongOpp }).recommended).toBe("training");
  });

  it("Wochenübersicht und ‚nicht vergessen‘", () => {
    const league = perFormation.find((f) => f.code === "442")!.positions;
    const f = planFriendly(hrf.players, { positions: league }, T, false, new Map(), hrf.team.formationExperience);
    const tiers = suggestSquads(hrf.players, league.map((p) => p.playerId), t);
    const rows = weekRows(hrf.players, tiers, t, new Map(), league, f.lineup.positions);
    expect(rows.filter((r) => r.factor >= 1).length).toBe(9);
    for (const r of forgotten(rows, t)) expect(r.factor).toBe(0);
    expect(weekFactor(undefined)).toBe(0);
  });
});
