import { describe, expect, it } from "vitest";
import type { HoData, SkillSnapshot } from "../src/core/hodata";
import type { Player } from "../src/core/model";
import { seasonProgress, seasonTrainingDates } from "../src/core/progress";

const d = (s: string) => new Date(s);
const snap = (date: string, playmaking: number, stamina = 6): SkillSnapshot => ({
  date: d(date),
  age: 20,
  ageDays: 10,
  keeper: 1,
  defending: 3,
  playmaking,
  winger: 3,
  passing: 3,
  scoring: 3,
  setPieces: 3,
  form: 6,
  formSub: 0,
  stamina,
  tsi: 1000,
});
const week = (date: string) => ({ date: d(date), type: 8, intensity: 100, staminaShare: 15, coachLevel: 6, assistantsLevel: 4, source: 1 });

function data(): HoData {
  return {
    generated: d("2026-11-27T16:00:00"),
    teamId: 1,
    matches: [
      { id: 11, type: 1, date: d("2026-11-14T18:15:00") } as HoData["matches"][number],
      { id: 12, type: 1, date: d("2026-11-21T18:15:00") } as HoData["matches"][number],
      { id: 13, type: 50, date: d("2026-11-22T18:15:00") } as HoData["matches"][number],
    ],
    fixtures: [{ leagueId: 5, season: 96, round: 1, date: d("2026-11-14T18:15:00"), homeId: 1, homeName: "A", awayId: 2, awayName: "B", homeGoals: 0, awayGoals: 0, matchId: 11 }],
    currentLeague: { id: 5, season: 96, name: "VII.1" },
    history: new Map([
      [100, [snap("2026-11-12T10:00:00", 5.4), snap("2026-11-20T10:00:00", 5.7), snap("2026-11-27T10:00:00", 6.05, 7)]],
      [200, [snap("2026-11-12T10:00:00", 4.1), snap("2026-11-27T10:00:00", 4.1)]],
    ]),
    training: [week("2026-11-13T00:30:00"), week("2026-11-20T00:30:00"), week("2026-11-27T00:30:00")],
    futureTraining: [],
    matchRatings: [],
    lineupPlayers: [
      { matchId: 11, teamId: 1, playerId: 100, roleId: 107, name: "", date: d("2026-11-14T18:15:00") },
      { matchId: 12, teamId: 1, playerId: 100, roleId: 106, name: "", date: d("2026-11-21T18:15:00") },
      { matchId: 13, teamId: 1, playerId: 200, roleId: 108, name: "", date: d("2026-11-22T18:15:00") },
    ],
    avatars: new Map(),
    transfers: null,
  };
}
const player = (id: number, playmaking: number, stamina: number) => ({ id, name: `P${id}`, age: 20, ageDays: 10, keeper: 1, defending: 3, playmaking, winger: 3, passing: 3, scoring: 3, setPieces: 3, stamina }) as unknown as Player;
const setup = { type: 8, intensity: 100, staminaShare: 15, coachLevel: 6, assistantsLevel: 4 };

describe("Trainingsfortschritt", () => {
  it("legt die 16 Trainings auf den Freitag vor dem 1. Spieltag", () => {
    const dates = seasonTrainingDates(d("2026-11-14T18:15:00"), []);
    expect(dates).toHaveLength(16);
    expect(dates[0].getDate()).toBe(13);
    expect(dates[1].getDate()).toBe(20);
  });

  it("zählt Einsätze, Aufstiege und Erwartung", () => {
    const r = seasonProgress(data(), [player(100, 6, 7), player(200, 4, 6)], setup, d("2026-11-27T16:00:00"))!;
    expect(r.season).toBe(96);
    expect(r.weeks.filter((w) => w.done)).toHaveLength(3);
    expect(r.weeks.some((w) => w.beforeHistory)).toBe(false);
    const p = r.players.find((x) => x.id === 100)!;
    // Spiel 14.11. (ZM) zählt fürs Update am 20.11., Spiel 21.11. (Flügel) fürs Update am 27.11.
    expect(p.shares.slice(0, 3)).toEqual([0, 1, 0.5]);
    expect(p.changes.map((c) => `${c.skill}${c.from}>${c.to}@${c.week}`)).toEqual(["playmaking5>6@3", "stamina6>7@3"]);
    expect(r.trainedUps).toBe(1);
    expect(r.staminaUp).toBe(1);
    expect(r.expectedUps).toBeGreaterThan(0.2);
    expect(r.curve.at(-1)!.actual).toBe(1);
    // Turnierspiel zählt nicht
    expect(r.players.find((x) => x.id === 200)!.shares.slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("ohne Spielplan der Saison gibt es keine Auswertung", () => {
    const h = data();
    h.fixtures = [];
    expect(seasonProgress(h, [player(100, 6, 7)], setup, d("2026-11-27T16:00:00"))).toBeNull();
  });
});
