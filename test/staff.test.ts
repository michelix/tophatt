import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contractWeeksFor,
  efficiencyFrontier,
  externalTrainerPrice,
  internalTrainerPrice,
  maxTrainerLevelForExperience,
  planOptions,
  staffFromHrf,
  staffWeeklyCost,
  trainingEfficiency,
} from "../src/core/staff";

const eff = (trainerLevel: number, assistantLevels: number, staminaShare = 15, intensity = 100) =>
  Math.round(trainingEfficiency({ trainerLevel, assistantLevels, staminaShare, intensity }) * 100);

describe("Trainingseffizienz wie Hattrick-Sandbox", () => {
  it("trifft alle gemessenen Werte (Spielaufbau 85 %, Intensität 100 %)", () => {
    expect(eff(3, 4)).toBe(60);
    expect(eff(5, 0)).toBe(63);
    expect(eff(3, 0)).toBe(53);
    expect(eff(5, 4)).toBe(72);
    expect(eff(4, 4)).toBe(66);
    expect(eff(4, 5)).toBe(68);
    expect(eff(4, 6)).toBe(70);
    expect(eff(4, 7)).toBe(72);
    expect(eff(4, 8)).toBe(74);
  });
  it("Bestwert 100 % mit Trainer 5, zehn Assistenzstufen und ohne Kondition", () => {
    expect(eff(5, 10, 0)).toBe(100);
  });
});

describe("Kosten", () => {
  it("Spezialisten-Tabelle", () => {
    expect(staffWeeklyCost(3, 16)).toBe(4080);
    expect(staffWeeklyCost(1, 8)).toBe(1500);
    expect(staffWeeklyCost(5, 1)).toBe(33840);
    expect(contractWeeksFor(3, 4080)).toBe(16);
    expect(contractWeeksFor(1, 1500)).toBe(8);
  });
  it("Trainerpreise extern und eigener Spieler", () => {
    expect(externalTrainerPrice(3, 6)).toBe(521000);
    expect(externalTrainerPrice(5, 6)).toBe(12505200);
    expect(internalTrainerPrice(2, 6)).toBe(34700);
    expect(internalTrainerPrice(3, 6)).toBe(277700);
    expect(internalTrainerPrice(4, 6)).toBeNull();
    expect(maxTrainerLevelForExperience(8)).toBe(5);
  });
});

const STAFF_HRF = `[club]
hjTranare=4
[team]
trLevel=100
staminaTrainingPart=15
trTypeValue=8
[economy]
Cash=4577650
[xtra]
CurrencyRate=10
TrainerID=900
TrainerName=Test Trainer
[player900]
led=4
TrainerSkillLevel=3
TrainerStatus=2
[player901]
firstname=Erfahrener
lastname=Spieler
ald=32
rut=6
led=6
arrivaldate=2026-01-01 10:00:00
[player902]
firstname=Junger
lastname=Spieler
ald=18
rut=2
led=5
[staff]
staff0Name=
staff0StaffId=900
staff0StaffType=2
staff0StaffLevel=3
staff0Cost=50000
staff1Name=Assi Eins
staff1StaffId=1
staff1StaffType=1
staff1StaffLevel=1
staff1Cost=15000
staff2Name=Assi Drei
staff2StaffId=2
staff2StaffType=1
staff2StaffLevel=3
staff2Cost=40800
staff3Name=Arzt
staff3StaffId=3
staff3StaffType=2
staff3StaffLevel=3
staff3Cost=40800
`;

describe("Personal aus HRF", () => {
  const s = staffFromHrf(STAFF_HRF);
  it("liest Trainer, Assistenten, Arzt und Kosten", () => {
    expect(s.trainer).toMatchObject({ level: 3, leadership: 4, weeklyCost: 5000, name: "Test Trainer" });
    expect(s.assistantLevels).toBe(4);
    expect(s.members.filter((m) => m.type === 1 && !m.isTrainer).map((m) => m.contractWeeks)).toEqual([8, 16]);
    expect(s.members.reduce((a, m) => a + m.weeklyCost, 0)).toBe(14660);
    expect(s.cash).toBe(457765);
    expect(s.candidates.map((c) => c.name)).toEqual(["Erfahrener Spieler"]);
  });
  it("Optionen: aktuelle Effizienz 60 %, Grenze steigt mit den Kosten", () => {
    const { base, options } = planOptions({ snapshot: s, horizonWeeks: 16, leadership: 6, contractWeeks: 16, reserve: 0, now: new Date("2026-11-21") });
    expect(Math.round(base.efficiency * 100)).toBe(60);
    expect(base.weekly).toBe(5000 + 1500 + 4080);
    const f = efficiencyFrontier(options);
    for (let i = 1; i < f.length; i++) {
      expect(f[i].extraWeekly).toBeGreaterThanOrEqual(f[i - 1].extraWeekly);
      expect(f[i].result.efficiency).toBeGreaterThan(f[i - 1].result.efficiency);
    }
    // externer Trainer 4 für 1,76 Mio ist bei 457 765 € nicht bezahlbar
    expect(options.find((o) => o.plan.trainerSource === "external" && o.plan.trainerLevel === 4)!.affordable).toBe(false);
  });
  it("alte Fixture ohne [staff] nutzt hjTranare", () => {
    const old = staffFromHrf(readFileSync("test/fixtures/team.hrf", "utf8"));
    expect(old.assistantLevels).toBe(1);
    expect(old.trainer?.level).toBe(3);
  });
});
