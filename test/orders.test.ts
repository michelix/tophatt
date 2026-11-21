import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf, writeLineupToHrf } from "../src/core/hrf";
import { completeLineup } from "../src/core/editor";
import { defaultMatchSettings, type Lineup } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { autoPenaltyTakers, maxOrders, newOrder, orderProblems, penaltyStrength, validBackups } from "../src/core/orders";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const best = optimizeLineup(hrf.players, defaultMatchSettings, team, { formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, tryBehaviours: false, minFormationExperience: 6, allowBruised: false });
const lineup = completeLineup(best.lineup.positions, hrf.players, defaultMatchSettings, false);
const byId = new Map(hrf.players.map((p) => [p.id, p]));
const benchIds = Object.values(lineup.bench).filter(Boolean) as number[];
const field = lineup.positions.map((p) => p.playerId);

/** liest den [lineup]-Abschnitt so wie HO: Schlüssel klein geschrieben */
function hoProps(text: string): Map<string, string> {
  const sec = text.split(/\r?\n\[/).find((s) => s.startsWith("lineup]"))!;
  return new Map(
    sec
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).toLowerCase(), l.slice(l.indexOf("=") + 1)]),
  );
}

describe("Elfmeterschützen", () => {
  it("wählt wie HO höchstens 11 aus Startelf und Bank, stärkste zuerst", () => {
    const pens = autoPenaltyTakers(lineup, byId);
    expect(pens.length).toBe(Math.min(11, field.length + benchIds.length));
    for (const id of pens) expect([...field, ...benchIds]).toContain(id);
    const v = pens.map((id) => penaltyStrength(byId.get(id)!));
    expect([...v].sort((a, b) => b - a)).toEqual(v);
  });

  it("schreibt penalty0 … penalty10", () => {
    const pens = autoPenaltyTakers(lineup, byId).slice(0, 3);
    const p = hoProps(writeLineupToHrf(hrf, { ...lineup, penaltyTakers: pens }, 123, 1));
    expect(p.get("penalty0")).toBe(String(pens[0]));
    expect(p.get("penalty2")).toBe(String(pens[2]));
    expect(p.get("penalty3")).toBe("0");
    expect(p.get("penalty10")).toBe("0");
    expect(p.has("penalty11")).toBe(false);
  });
});

describe("Auswechslungen und Anweisungen", () => {
  const sub = { ...newOrder("sub", field[5], benchIds[1]), minute: 65, role: 107, behaviour: 1, standing: 2, card: -1 };
  const beh = { ...newOrder("behaviour", field[8]), minute: 75, behaviour: 2, standing: 1 };
  const swap = { ...newOrder("swap", field[6], field[7]), minute: 46 };
  const mark = newOrder("marking", field[3], 471234567);
  const withOrders: Lineup = { ...lineup, orders: [sub, beh, swap, mark] };

  it("schreibt die Schlüssel, die HO in Lineup(Properties) liest", () => {
    const p = hoProps(writeLineupToHrf(hrf, withOrders, 123, 1));
    expect(p.get("subst0playerorderid")).toBe("0");
    expect(p.get("subst0playerin")).toBe(String(benchIds[1]));
    expect(p.get("subst0playerout")).toBe(String(field[5]));
    expect(p.get("subst0ordertype")).toBe("1");
    expect(p.get("subst0matchminutecriteria")).toBe("65");
    expect(p.get("subst0pos")).toBe("107");
    expect(p.get("subst0behaviour")).toBe("1");
    expect(p.get("subst0standing")).toBe("2");
    expect(p.get("subst0card")).toBe("-1");
    // Verhalten: rein = raus (so erkennt HO NEW_BEHAVIOUR)
    expect(p.get("subst1playerin")).toBe(p.get("subst1playerout"));
    expect(p.get("subst1ordertype")).toBe("1");
    expect(p.get("subst2ordertype")).toBe("3");
    expect(p.get("subst2pos")).toBe("-1");
    expect(p.get("subst3ordertype")).toBe("4");
    expect(p.get("subst3playerin")).toBe("471234567");
    expect(p.has("subst4playerorderid")).toBe(false);
  });

  it("ohne Anweisungen keine subst-Schlüssel", () => {
    const p = hoProps(writeLineupToHrf(hrf, lineup, 123, 1));
    expect([...p.keys()].some((k) => /^subst\d/.test(k))).toBe(false);
  });

  it("erkennt Fehler wie HO", () => {
    expect(orderProblems(withOrders.orders!, lineup, byId, 0).every((x) => x.length === 0)).toBe(true);
    const bad = orderProblems([newOrder("sub", field[0], field[1]), newOrder("marking", field[2]), newOrder("marking", field[2], 5)], lineup, byId, 0);
    expect(bad[0].join()).toMatch(/nicht auf der Bank/);
    expect(bad[1].join()).toMatch(/Gegenspieler fehlt/);
    expect(bad[2].join()).toMatch(/Nur eine Manndeckung/);
  });

  it("begrenzt auf 5 + Taktik-Assistent, Manndeckung zählt nicht", () => {
    expect(maxOrders(0)).toBe(5);
    const many = Array.from({ length: 6 }, () => ({ ...newOrder("behaviour", field[1]), behaviour: 1 }));
    const r = orderProblems([...many, newOrder("marking", field[2], 9)], lineup, byId, 0);
    expect(r[4]).toEqual([]);
    expect(r[5].join()).toMatch(/Zu viele/);
    expect(r[6]).toEqual([]);
    expect(orderProblems(many, lineup, byId, 1)[5]).toEqual([]);
  });
});

describe("Reserve-Reihe der Bank", () => {
  it("nur andere Bankspieler sind erlaubt und landen in substxx2", () => {
    const b = validBackups(lineup.bench, { keeper: lineup.bench.keeper, centralDefender: lineup.bench.forward, wingBack: field[0] });
    expect(b).toEqual({ centralDefender: lineup.bench.forward });
    const p = hoProps(writeLineupToHrf(hrf, { ...lineup, backups: { centralDefender: lineup.bench.forward, wingBack: field[0] } }, 123, 1));
    expect(p.get("substcd2")).toBe(String(lineup.bench.forward));
    expect(p.get("substwb2")).toBe("0");
  });
});

describe("Reserve automatisch", () => {
  it("füllt jeden besetzten Bankplatz mit einem anderen Bankspieler, eigene Wahl bleibt", async () => {
    const { autoBackups } = await import("../src/core/orders");
    const auto = autoBackups(lineup.bench, byId);
    for (const [slot, id] of Object.entries(auto)) {
      expect(benchIds).toContain(id);
      expect(lineup.bench[slot as keyof typeof lineup.bench]).not.toBe(id);
    }
    expect(Object.keys(auto).length).toBe(benchIds.length);
    const own = autoBackups(lineup.bench, byId, { keeper: 0, centralDefender: lineup.bench.forward });
    expect(own.keeper).toBeUndefined();
    expect(own.centralDefender).toBe(lineup.bench.forward);
  });
});
