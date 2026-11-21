import { describe, expect, it } from "vitest";
import { checkAffordability, normalWeek, parseFinance, parseStaff, pastWeeks } from "../src/core/finance";

// ausgedachte Zahlen, Aufbau wie eine echte HO-HRF (Geld in Basiseinheit, CurrencyRate 10)
const hrf = (date: string, economyDate: string, cash: number, lastSpectators: number) => `[basics]
date=${date}
[club]
fanclub=600
[economy]
Cash=${cash}
ExpectedCash=${cash - 30000}
SupportersPopularity=8
IncomeSpectators=0
IncomeSponsors=400000
IncomeSponsorsBonus=50000
IncomeSoldPlayers=20000
IncomeTemporary=20000
IncomeSum=470000
CostsArena=70000
CostsPlayers=180000
CostsStaff=150000
CostsBoughtPlayers=0
CostsYouth=100000
CostsSum=500000
LastIncomeSpectators=${lastSpectators}
LastIncomeSponsors=400000
LastIncomeSponsorsBonus=50000
LastIncomeSum=${lastSpectators + 450000}
lastCostsArena=70000
LastCostsPlayers=100000
lastCostsPersonal=60000
LastCostsBoughtPlayers=1000000
LastCostsYouth=100000
LastCostsSum=1340000
[staff]
staff0Name=
staff0StaffId=900
staff0StaffType=2
staff0StaffLevel=3
staff0Cost=50000
staff1Name=Hans Hilfe
staff1StaffId=901
staff1StaffType=1
staff1StaffLevel=3
staff1Cost=40800
staff2Name=Doris Doktor
staff2StaffId=902
staff2StaffType=2
staff2StaffLevel=2
staff2Cost=59200
[xtra]
EconomyDate=${economyDate}
CurrencyRate=10
TrainerID=900
TrainerName=Tom Trainer
`;

const now = parseFinance(hrf("2026-11-21 09:00:00", "2026-11-28 00:10:00", 5_000_000, 1_200_000))!;
const old = parseFinance(hrf("2026-11-15 09:00:00", "2026-11-21 00:10:00", 9_000_000, 200_000))!;
const older = parseFinance(hrf("2026-11-16 09:00:00", "2026-11-21 00:10:00", 9_100_000, 200_000))!;

describe("Finanzen aus der HRF", () => {
  it("rechnet Geld in Euro und teilt die Wochenbilanz auf", () => {
    expect(now.cash).toBe(500_000);
    expect(now.expectedCash).toBe(497_000);
    expect(now.thisWeek.income.sponsors + now.thisWeek.income.sponsorsBonus).toBe(45_000);
    expect(now.thisWeek.income.other).toBe(2_000);
    expect(now.thisWeek.costs.staff).toBe(15_000);
    expect(now.thisWeek.total).toBe(-3_000);
    expect(now.lastWeek.costs.staff).toBe(6_000);
    expect(now.lastWeek.costs.other).toBe(101_000);
  });
  it("erkennt den Trainer im Personal und benennt Spezialisten", () => {
    const s = parseStaff(hrf("x", "x", 0, 0));
    expect(s[0]).toMatchObject({ isTrainer: true, name: "Tom Trainer", typeName: "Trainer", weeklyCost: 5000 });
    expect(s.find((m) => m.id === 901)).toMatchObject({ typeName: "Assistenztrainer", level: 3, weeklyCost: 4080 });
    expect(s.find((m) => m.id === 902)?.typeName).toBe("Sportmediziner");
    expect(s.reduce((a, m) => a + m.weeklyCost, 0)).toBe(now.thisWeek.costs.staff);
  });
  it("zählt jede abgeschlossene Woche einmal", () => {
    const weeks = pastWeeks([now, old, older]);
    expect(weeks.map((w) => w.week)).toEqual(["2026-11-14", "2026-11-21"]);
    const n = normalWeek(now, weeks);
    expect(n.spectators).toBe(70_000);
    expect(n.costs).toBe(50_000);
    expect(n.total).toBe(65_000);
  });
});

describe("Bankrott-Ampel", () => {
  const normal = normalWeek(now, pastWeeks([now, old]));
  it("ohne Änderung tragbar", () => {
    const a = checkAffordability(now, { extraWeeklyCost: 0, oneTimeCost: 0 }, { normal });
    expect(a.verdict).toBe("ok");
    expect(a.forecast).toHaveLength(16);
    expect(a.forecast[1] - a.forecast[0]).toBe(65_000);
  });
  it("teurer Trainer mit hohem Kaufpreis treibt ins Minus", () => {
    const a = checkAffordability(now, { extraWeeklyCost: 5_000, oneTimeCost: 521_000 }, { normal });
    expect(a.verdict).toBe("gefahr");
    expect(a.weeksUntilDebt).toBe(1);
  });
  it("knapp, wenn der Puffer unterschritten wird", () => {
    const a = checkAffordability(now, { extraWeeklyCost: 0, oneTimeCost: 450_000 }, { normal, buffer: 100_000 });
    expect(a.verdict).toBe("knapp");
  });
  it("maxExtraWeekly hält genau den Puffer", () => {
    const a = checkAffordability(now, { extraWeeklyCost: 0, oneTimeCost: 0 }, { normal, buffer: 100_000 });
    const b = checkAffordability(now, { extraWeeklyCost: a.maxExtraWeekly, oneTimeCost: 0 }, { normal, buffer: 100_000 });
    expect(b.minCash).toBeGreaterThanOrEqual(100_000);
    const c = checkAffordability(now, { extraWeeklyCost: a.maxExtraWeekly + 1000, oneTimeCost: 0 }, { normal, buffer: 100_000 });
    expect(c.minCash).toBeLessThan(100_000);
  });
  it("HRF ohne Wirtschaftsdaten liefert null", () => {
    expect(parseFinance("[basics]\ndate=x\n")).toBeNull();
  });
});

describe("Ansparen", () => {
  it("sagt, ab wann ein teurer Kauf bezahlbar ist", () => {
    const normal = normalWeek(now, pastWeeks([now, old]));
    const a = checkAffordability(now, { extraWeeklyCost: 0, oneTimeCost: 521_000 }, { normal, buffer: 100_000 });
    // 497.000 + 65.000·k − 521.000 ≥ 100.000 → k = 2
    expect(a.affordableInWeeks).toBe(2);
    expect(checkAffordability(now, { extraWeeklyCost: 0, oneTimeCost: 0 }, { normal }).affordableInWeeks).toBe(0);
    expect(checkAffordability(now, { extraWeeklyCost: 200_000, oneTimeCost: 0 }, { normal }).affordableInWeeks).toBeNull();
  });
});
