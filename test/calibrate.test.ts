import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { Behaviour, Location, Role, Tactic, defaultMatchSettings, type MatchSettings } from "../src/core/model";
import { averageRatings, hatStats, ratingsAtMinute, type FieldEntry } from "../src/core/rating";
import { Evaluator } from "../src/core/optimizer";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const byId = new Map(hrf.players.map((p) => [p.id, p]));
const f = (id: number, role: number, behaviour = Behaviour.normal): FieldEntry => ({ player: byId.get(id)!, role: role as never, behaviour: behaviour as never });
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };

// Aufstellung, die bei Hattrick für das Pokalspiel hinterlegt war (HO-Screenshot: HatStats 184)
const htLineup = [
  f(700049, Role.keeper),
  f(700055, Role.rightBack),
  f(700053, Role.rightCentralDefender),
  f(700059, Role.leftCentralDefender),
  f(700052, Role.leftBack),
  f(700056, Role.rightWinger),
  f(700060, Role.centralInnerMidfield),
  f(700058, Role.leftInnerMidfield),
  f(700062, Role.leftWinger),
  f(700065, Role.rightForward),
  f(700066, Role.centralForward),
];

describe("Kalibrierung gegen HO", () => {
  it("liest 22 Spieler ohne Trainer", () => {
    expect(hrf.players.length).toBe(22);
    expect(hrf.team.teamName).toBe("Testverein 1900");
  });
  it("HatStats der Hattrick-Aufstellung liegen höchstens 5 % neben HOs 184 (Spielbeginn, Heimspiel)", () => {
    // HO kennt zusätzlich Unterstufen aus der Trainingshistorie; wir rechnen mit Form +0,5 und sonst ganzen Stufen.
    const m: MatchSettings = { ...defaultMatchSettings, location: Location.home, tactic: Tactic.normal };
    const hs = hatStats(ratingsAtMinute(htLineup, 0, m, team));
    expect(Math.abs(hs - 184) / 184).toBeLessThan(0.05);
    // 90-Minuten-Schnitt liegt wegen Kondition darunter
    expect(hatStats(averageRatings(htLineup, m, team))).toBeLessThan(hs);
  });
  it("Evaluator liefert dieselben Werte wie averageRatings", () => {
    const m: MatchSettings = { ...defaultMatchSettings, tactic: Tactic.pressing };
    const a = averageRatings(htLineup, m, team);
    const b = new Evaluator(m, team).ratings(htLineup);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(b[k]).toBeCloseTo(a[k], 9);
  });
});
