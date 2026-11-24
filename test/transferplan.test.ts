import { describe, expect, it } from "vitest";
import { checkAffordability, type FinanceSnapshot } from "../src/core/finance";
import { parseHoData } from "../src/core/hodata";
import type { Player } from "../src/core/model";
import type { SearchProfile } from "../src/core/scouting";
import { estimateSalary, maxPrice, rankProfiles, transferTotals } from "../src/core/transferplan";
import type { UpgradeHint } from "../src/core/advisor";

const snap = { expectedCash: 455_000 } as FinanceSnapshot;

describe("Höchstgebot", () => {
  it("hält den Puffer eine Saison lang, mit Gehalt", () => {
    const cap = maxPrice(snap, { total: 60_000 }, 100_000, { oneTime: 0, weekly: 0 }, 1_500);
    // Woche 0 ist am knappsten: 455.000 − Preis − 1.500 ≥ 100.000
    expect(cap).toBe(353_000);
    const a = checkAffordability({ ...snap } as FinanceSnapshot, { oneTimeCost: cap, extraWeeklyCost: 1_500 }, { normal: { spectators: 0, sponsors: 0, costs: 0, total: 60_000, basedOnWeeks: 1 }, buffer: 100_000 });
    expect(a.verdict).toBe("ok");
  });
  it("zählt andere geplante Käufe und Verkäufe mit", () => {
    expect(maxPrice(snap, { total: 60_000 }, 100_000, { oneTime: 200_000, weekly: 1_000 }, 1_500)).toBe(152_000);
    // Verkauf: Erlös 50.000, spart 500 Gehalt
    expect(maxPrice(snap, { total: 60_000 }, 100_000, { oneTime: -50_000, weekly: -500 }, 1_500)).toBe(404_000);
  });
  it("wächst mit dem Warten und ist nie negativ", () => {
    const c = { oneTime: 400_000, weekly: 0 };
    expect(maxPrice(snap, { total: 60_000 }, 100_000, c, 1_000)).toBe(0);
    expect(maxPrice(snap, { total: 60_000 }, 100_000, c, 1_000, 4)).toBe(194_000);
  });
  it("bei negativer typischer Woche zählt das Saisonende", () => {
    // 455.000 − P − 16·1.000 − 15·10.000 ≥ 100.000
    expect(maxPrice(snap, { total: -10_000 }, 100_000, { oneTime: 0, weekly: 0 }, 1_000)).toBe(189_000);
  });
});

const pl = (id: number, age: number, level: number, salary: number) => ({ id, age, salary, keeper: 1, defending: level, playmaking: 3, winger: 3, scoring: 3, passing: 3 }) as Player;

describe("Gehalt", () => {
  it("steigt je Stufe und enthält den Auslandszuschlag", () => {
    const squad = [pl(1, 25, 6, 400), pl(2, 26, 7, 600), pl(3, 28, 8, 950), pl(4, 17, 8, 3000)];
    const s8 = estimateSalary(squad, 8);
    expect(s8).toBeGreaterThan(950);
    expect(s8).toBeLessThan(1400);
    expect(estimateSalary(squad, 10)).toBeGreaterThan(s8 * 1.5);
  });
});

describe("Kaufreihenfolge", () => {
  const prof = (title: string, group: SearchProfile["group"], skill: string, kind: SearchProfile["kind"], priority: number) =>
    ({ title, group, kind, priority, reason: "", age: [27, 30], skills: [{ skill, name: skill, min: 8, max: 9 }] }) as SearchProfile;
  const up = (group: string, skillKey: string, weakGain: number, gainPlus2: number) => ({ group, skillKey, weakGain, gainPlus2 }) as UpgradeHint;
  it("Schwachstelle vor reinem HatStats-Zuwachs, Nachfolger zuletzt", () => {
    const r = rankProfiles(
      [prof("Nachfolger", "goal", "keeper", "langfristig", 2), prof("Flügel", "wing", "winger", "sofort", 2), prof("Torwart", "goal", "keeper", "sofort", 1), prof("Mitte", "innerMidfield", "playmaking", "sofort", 1)],
      { allUpgrades: [up("wing", "winger", 1.7, 1.7), up("goal", "keeper", 0, 5.4), up("innerMidfield", "playmaking", 3.4, 3.4)] },
      [pl(1, 25, 7, 500), pl(2, 27, 8, 800), pl(3, 29, 9, 1200)],
    );
    expect(r.map((x) => x.profile.title)).toEqual(["Mitte", "Flügel", "Torwart", "Nachfolger"]);
    expect(r[0].gain).toBeCloseTo(3.4);
    expect(r[3].gain).toBeNull();
  });
});

describe("bisherige Transfers", () => {
  it("liest HOs Tabelle TRANSFER und summiert in Euro", () => {
    const d = parseHoData(
      JSON.stringify({
        basics: [{ teamid: 7 }],
        transfers: [
          { transferid: 1, date: "2026-11-16 20:06:00", season: 96, week: 2, playerid: 11, playername: "A", buyerid: 7, buyername: "Wir", sellerid: 3, sellername: "X", price: 5_750_000, tsi: 9830 },
          { transferid: 2, date: "2026-11-21 06:53:00", season: 96, week: 2, playerid: 12, playername: "B", buyerid: 4, buyername: "Y", sellerid: 7, sellername: "Wir", price: 40_000, tsi: 1560 },
        ],
      }),
    );
    expect(d.transfers!.map((t) => t.playerName)).toEqual(["B", "A"]);
    expect(transferTotals(d.transfers!, 7, 10)).toEqual({ bought: 1, sold: 1, spent: 575_000, earned: 4_000 });
    expect(parseHoData("{}").transfers).toBeNull();
  });
});

describe("Suchprofile aus der Kaderplanung", () => {
  it("Lücke wird eigenes Profil auf Ersatzniveau und steht vorn; volle Gruppe bekommt Hinweis", async () => {
    const { searchProfiles } = await import("../src/core/scouting");
    const p = (id: number, defending: number, playmaking: number) => ({ id, age: 26, salary: 500, keeper: 1, defending, playmaking, winger: 6, scoring: 3, passing: 5, setPieces: 3 }) as unknown as Player;
    const pp = (player: Player) => ({ player, now: 5, later: 5 });
    const squad = {
      groups: [
        { group: "back", name: "Außenverteidigung", places: 2, missing: 1, starters: [pp(p(1, 7, 3)), pp(p(2, 8, 3))], backups: [pp(p(3, 6, 3))], talents: [], surplus: [] },
        { group: "innerMidfield", name: "Zentrales Mittelfeld", places: 2, missing: 0, starters: [pp(p(4, 4, 7)), pp(p(5, 4, 6))], backups: [], talents: [], surplus: [pp(p(6, 3, 5)), pp(p(7, 3, 5))] },
      ],
    } as never;
    const weak = [{ sector: "midfield", name: "Mittelfeld", severity: "critical", rating: 4.4, delta: -2 }] as never;
    const prof = searchProfiles([], weak, [], squad);
    expect(prof.map((x) => x.kind)).toEqual(["luecke", "sofort"]);
    expect(prof[0].group).toBe("back");
    expect(prof[0].skills[0]).toMatchObject({ skill: "defending", min: 6, max: 7 });
    expect(prof[1].reason).toMatch(/2 überzählig/);
    const r = rankProfiles(prof, { allUpgrades: [up2("innerMidfield", "playmaking", 3.5)] }, []);
    expect(r[0].profile.kind).toBe("luecke");
  });
});
function up2(group: string, skillKey: string, g: number) {
  return { group, skillKey, weakGain: g, gainPlus2: g } as UpgradeHint;
}
