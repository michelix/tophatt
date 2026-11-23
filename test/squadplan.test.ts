import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { type Player, Role, defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { DEV_SKILLS, type ProjectionPoint } from "../src/core/development";
import { planWholeSquad } from "../src/core/squadplan";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const best = optimizeLineup(hrf.players, defaultMatchSettings, team, { formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, tryBehaviours: false, minFormationExperience: 6, allowBruised: false });
const positions = best.lineup.positions;

/** Projektion: alle Fertigkeiten bleiben gleich, nur einzelne Spieler wachsen um `grow` Stufen */
const flat =
  (grow: Record<number, number> = {}) =>
  (p: Player): ProjectionPoint[] => {
    const values = Object.fromEntries(DEV_SKILLS.map((s) => [s, p[s] + (grow[p.id] ?? 0)])) as ProjectionPoint["values"];
    const now = Object.fromEntries(DEV_SKILLS.map((s) => [s, p[s]])) as ProjectionPoint["values"];
    return [{ week: 0, age: p.age, ageDays: p.ageDays, values: now }, ...Array.from({ length: 32 }, (_, i) => ({ week: i + 1, age: p.age + (i >= 15 ? 1 : 0), ageDays: p.ageDays, values }))];
  };

describe("Kaderplanung für den ganzen Kader", () => {
  const plan = planWholeSquad(hrf.players, positions, flat());

  it("jeder Spieler steht genau einmal, die Stammspieler sind die Elf der Aufstellung", () => {
    expect(plan.players.length).toBe(hrf.players.length);
    expect(new Set(plan.players.map((x) => x.player.id)).size).toBe(hrf.players.length);
    const starters = plan.players.filter((x) => x.role === "starter").map((x) => x.player.id).sort();
    expect(starters).toEqual(positions.map((p) => p.playerId).sort());
  });

  it("Soll je Mannschaftsteil: Plätze plus je Platz ein Ersatz, im Tor zwei; Ersatzplätze werden nicht überbucht", () => {
    for (const g of plan.groups) {
      expect(g.target).toBe(g.group === "goal" ? 2 : 2 * g.places);
      expect(g.starters.length + g.backups.length).toBeLessThanOrEqual(g.target);
      expect(g.missing).toBe(Math.max(0, g.target - g.starters.length - g.backups.length));
    }
    expect(plan.target).toBe(plan.groups.reduce((s, g) => s + g.target, 0));
  });

  it("Torhüter stehen im Tor, Feldspieler nicht", () => {
    const isKeeper = (p: Player) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.passing, p.scoring);
    for (const x of plan.players) if (x.role !== "starter") expect(x.group === "goal").toBe(isKeeper(x.player));
  });

  it("Überzählige kosten Gehalt, und dafür gibt es einen Schritt „verkaufen“", () => {
    const surplus = plan.players.filter((x) => x.role === "surplus" && x.player.injury <= 0);
    expect(plan.surplusSalary).toBeCloseTo(surplus.reduce((s, x) => s + x.player.salary, 0), 6);
    if (surplus.length) expect(plan.actions.some((a) => a.kind === "sell" && a.players.length === surplus.length)).toBe(true);
  });

  it("ein junger Spieler, der stark wächst, ist Talent statt überzählig", () => {
    const young = plan.players.find((x) => x.role === "surplus" && x.player.age <= 21 && x.group !== "goal");
    if (!young) return;
    const grown = planWholeSquad(hrf.players, positions, flat({ [young.player.id]: 4 }));
    const x = grown.players.find((y) => y.player.id === young.player.id)!;
    expect(["talent", "backup"]).toContain(x.role);
    if (x.role === "talent") expect(grown.actions.some((a) => a.kind === "develop" && a.players.includes(x.player.id))).toBe(true);
  });

  it("fehlt Ersatz, nennt der Plan die Lücke", () => {
    // nur die Elf plus ein Torwart: alle Feldgruppen ohne Ersatz
    const eleven = hrf.players.filter((p) => positions.some((q) => q.playerId === p.id));
    const p2 = planWholeSquad(eleven, positions, flat());
    const field = p2.groups.filter((g) => g.group !== "goal");
    expect(field.every((g) => g.missing === g.places)).toBe(true);
    expect(p2.actions.filter((a) => a.kind === "fill").length).toBe(p2.groups.length);
    expect(p2.groups.find((g) => g.group === "goal")!.status).toBe("gap");
  });

  it("ein abbauender Stammspieler bekommt einen Nachfolger-Schritt", () => {
    const st = positions.find((p) => p.role !== Role.keeper)!.playerId;
    const p3 = planWholeSquad(hrf.players, positions, flat({ [st]: -3 }));
    expect(p3.actions.some((a) => a.kind === "successor" && a.players.includes(st))).toBe(true);
  });
});
