import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseHrf } from "../src/core/hrf";
import { Role } from "../src/core/model";
import { TRAININGS, addPlanned, maxTrainingSlots, planFriendly, planTrainingLineup, playedThisWeek, trainingFor, trainingWindow, weekFactor } from "../src/core/training";

const hrf = parseHrf(readFileSync("test/fixtures/team.hrf", "utf8"));
const PM = 8; // Spielaufbau
const t = TRAININGS[PM];

describe("Trainingswoche (Regeln wie HO)", () => {
  it("Spielaufbau: zentrales Mittelfeld voll, Flügel halb, sonst nichts", () => {
    expect(trainingFor(Role.centralInnerMidfield, t)).toBe("voll");
    expect(trainingFor(Role.leftWinger, t)).toBe("teilweise");
    expect(trainingFor(Role.leftCentralDefender, t)).toBe("keins");
    expect(maxTrainingSlots(t)).toMatchObject({ full: 3, partly: 2 });
  });
  it("Minuten beider Spiele zählen zusammen, höchstens 90; volle Minuten zuerst", () => {
    expect(weekFactor({ full: 90, partly: 90 })).toBe(1);
    expect(weekFactor({ full: 0, partly: 90 })).toBe(0.5);
    expect(weekFactor({ full: 45, partly: 90 })).toBeCloseTo(0.75);
    expect(weekFactor({ full: 36, partly: 90 })).toBeCloseTo(0.7); // Beispiel aus HO
    expect(weekFactor({ full: 200, partly: 0 })).toBe(1);
  });
  it("Trainingswoche aus den HO-Terminen, sonst Freitag 00:30", () => {
    const dates = [new Date("2026-11-13T00:30:00"), new Date("2026-11-20T00:30:00"), new Date("2026-11-27T00:30:00")];
    const w = trainingWindow(new Date("2026-11-22T10:00:00"), dates);
    expect(w.start).toEqual(dates[1]);
    expect(w.end).toEqual(dates[2]);
    const f = trainingWindow(new Date("2026-11-24T10:00:00"), []);
    expect(f.start).toEqual(new Date("2026-11-20T00:30:00"));
    expect(f.end).toEqual(new Date("2026-11-27T00:30:00"));
  });
  it("liest das letzte Spiel aus der HRF und zählt es nur in der laufenden Woche", () => {
    const p = hrf.players.find((x) => x.lastMatchMinutes)!;
    expect(p.lastMatchDate).toBe("2026-11-14 18:15:00");
    const inWeek = trainingWindow(new Date("2026-11-15T12:00:00"), [new Date("2026-11-13T00:30:00")]);
    const before = trainingWindow(new Date("2026-11-21T12:00:00"), [new Date("2026-11-20T00:30:00")]);
    const def = TRAININGS[3];
    const played = playedThisWeek(hrf.players, def, inWeek);
    expect(played.size).toBe(hrf.players.filter((x) => x.lastMatchMinutes && x.lastMatchPosition >= 100 && x.lastMatchDate! >= "2026-11-13 00:30").length);
    expect(played.size).toBeGreaterThan(0);
    expect(playedThisWeek(hrf.players, def, before).size).toBe(0);
  });
});

describe("Trainingsaufstellung aus noch nicht trainierten Spielern", () => {
  const players = hrf.players.map((p) => ({ ...p }));
  // Ligaspiel dieser Woche schon gespielt: drei Spieler im zentralen Mittelfeld, einer auf dem Flügel
  const ids = players.filter((p) => p.injury < 0 && p.keeper < 5).map((p) => p.id);
  const played = new Map([
    [ids[0], { full: 90, partly: 0, sources: ["gespielt ZM"] }],
    [ids[1], { full: 90, partly: 0, sources: ["gespielt ZM"] }],
    [ids[2], { full: 90, partly: 0, sources: ["gespielt ZM"] }],
    [ids[3], { full: 0, partly: 90, sources: ["gespielt FL"] }],
  ]);

  it("nimmt 3 zentrale Mittelfeldspieler und 2 Flügel, keiner davon schon voll trainiert", () => {
    const plan = planTrainingLineup(players, PM, played, true);
    expect(plan.lineup.positions).toHaveLength(11);
    const full = plan.lineup.positions.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId);
    expect(full).toHaveLength(3);
    for (const id of full) expect(weekFactor(played.get(id))).toBeLessThan(1);
    expect(plan.gaining.length).toBeGreaterThanOrEqual(5);
    // nach der Woche: 6 voll trainiert
    expect([...plan.after.values()].filter((m) => weekFactor(m) >= 1).length).toBeGreaterThanOrEqual(6);
  });

  it("bevorzugt bei gleichen Fähigkeiten den jüngeren Spieler", () => {
    const a = { ...players[5], id: 1, age: 18, playmaking: 6, keeper: 1, injury: -1, cards: 0 };
    const b = { ...a, id: 2, age: 29 };
    const plan = planTrainingLineup([a, b, ...players.filter((p) => p.playmaking < 5)], PM, new Map(), true);
    const full = plan.lineup.positions.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId);
    expect(full).toContain(1);
  });

  it("Freundschaftsspiel: Liga-Aufstellung zählt mit, Hinweis nennt das Wochenmaximum", () => {
    const league = { positions: [Role.leftInnerMidfield, Role.centralInnerMidfield].map((role, i) => ({ role, playerId: ids[i + 4] })) };
    const f = planFriendly(players, league, PM, true);
    expect(f.trainedInLeague).toEqual(expect.arrayContaining([ids[4], ids[5]]));
    expect(f.trainedInFriendly).not.toContain(ids[4]);
    expect(f.notes.join(" ")).toContain("Höchstens 6 Spieler pro Woche");
    const merged = addPlanned(new Map(), league.positions, t, "Liga");
    expect(weekFactor(merged.get(ids[4]))).toBe(1);
  });
});

describe("Trainingself ohne Torhüter im Feld", () => {
  it("stellt keinen Torwart als Feldspieler auf, wenn Feldspieler da sind", () => {
    const plan = planTrainingLineup(hrf.players, PM, playedThisWeek(hrf.players, t, trainingWindow(new Date("2026-11-15T12:00:00"), [new Date("2026-11-13T00:30:00")])), true);
    const byId = new Map(hrf.players.map((p) => [p.id, p]));
    for (const pos of plan.lineup.positions) {
      const p = byId.get(pos.playerId)!;
      const keeperType = p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);
      expect(keeperType && pos.role !== Role.keeper).toBe(false);
    }
    expect(plan.lineup.formation).not.toBe("550");
  });
});
