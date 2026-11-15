import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf, writeLineupToHrf } from "../src/core/hrf";
import { Location, Tactic, defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { planFriendly } from "../src/core/training";
import { advise } from "../src/core/advisor";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const settings = { ...defaultMatchSettings, location: Location.away, tactic: Tactic.normal };
const name = (id: number) => hrf.players.find((p) => p.id === id)?.name ?? "-";

describe("Optimierer mit echten Kaderdaten", () => {
  const t0 = Date.now();
  const res = optimizeLineup(hrf.players, settings, team, {
    minFormationExperience: 6,
    formationExperience: hrf.team.formationExperience,
    objective: HATSTATS_OBJECTIVE,
    allowBruised: true,
    tryBehaviours: false,
  });
  const ms = Date.now() - t0;

  it("liefert eine gültige Elf in einer erfahrenen Formation", () => {
    console.log(`Formation ${res.lineup.formation}, HatStats Ø90 ${res.hatStats.toFixed(1)} in ${ms} ms`);
    for (const p of res.lineup.positions) console.log(p.role, p.behaviour, name(p.playerId));
    console.log("Bank", Object.entries(res.lineup.bench).map(([k, v]) => `${k}:${name(v!)}`).join(", "));
    console.log("Kapitän", name(res.lineup.captainId), "Standards", name(res.lineup.setPiecesId));
    console.log(res.perFormation);
    expect(res.lineup.positions.length).toBe(11);
    expect(new Set(res.lineup.positions.map((p) => p.playerId)).size).toBe(11);
    expect(["442", "433"]).toContain(res.lineup.formation);
    // Dorn ist verletzt
    expect(res.lineup.positions.some((p) => p.playerId === 700064)).toBe(false);
    expect(ms).toBeLessThan(5000);
  });

  it("Freundschaftsspiel setzt die übrigen Spieler auf Trainingspositionen", () => {
    const plan = planFriendly(hrf.players, res.lineup, hrf.team.trainingType, true);
    console.log("Friendly", plan.lineup.formation, plan.lineup.positions.map((p) => `${p.role}:${name(p.playerId)}`).join(", "));
    console.log(plan.notes, "untrained:", plan.untrained.map(name));
    expect(plan.lineup.positions.length).toBe(11);
    expect(plan.trainedInFriendly.length).toBeGreaterThanOrEqual(4);
  });

  it("Berater liefert Hinweise", () => {
    const a = advise(hrf.players, res.lineup, settings, team, hrf.team.trainingType);
    console.log(JSON.stringify(a, null, 1).slice(0, 2500));
    expect(a.upgrades.length).toBeGreaterThan(0);
    // Gehälter in Euro (HRF: Zehntel-Euro); Mistel verdient 1.236 €/Woche
    expect(hrf.players.find((p) => p.id === 700046)!.salary).toBeCloseTo(1236, 0);
  });

  it("schreibt eine HRF-Datei, die wieder gelesen werden kann", () => {
    const out = writeLineupToHrf(hrf, res.lineup, 700151, 1);
    const again = parseHrf(out);
    expect(again.players.length).toBe(22);
    expect(again.lineupMatchId).toBe(700151);
    expect(out).toContain(`captain=${res.lineup.captainId}`);
    expect(out.split("[lineup]").length).toBe(2);
    expect(out).toContain("[economy]");
  });
});
