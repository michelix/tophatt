import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf } from "../src/core/hrf";
import { completeLineup } from "../src/core/editor";
import { defaultMatchSettings, type Player } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";
import { MAX_SUBSTITUTIONS, SAFE_LEAD, bestStrengthMinute, ruleOfThumb, suggestSubstitutions, suggestionToOrder } from "../src/core/substitutions";
import { TRAININGS, type WeekMinutes } from "../src/core/training";
import { orderProblems } from "../src/core/orders";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const best = optimizeLineup(hrf.players, defaultMatchSettings, team, { formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, tryBehaviours: false, minFormationExperience: 6, allowBruised: false });
const lineup = completeLineup(best.lineup.positions, hrf.players, defaultMatchSettings, false);
const byId = new Map(hrf.players.map((p) => [p.id, p]));
const training = TRAININGS[hrf.team.trainingType];
const benchIds = new Set(Object.values(lineup.bench).filter(Boolean) as number[]);
const fieldIds = new Set(lineup.positions.map((p) => p.playerId));

describe("Konditionswechsel", () => {
  it("wechselt einen konditionsschwachen Spieler früher aus als einen fitten", () => {
    const pos = lineup.positions.find((p) => p.role !== 100)!;
    const a = byId.get(pos.playerId)!;
    const sub = { ...a, id: 1 } as Player;
    const weak = bestStrengthMinute({ ...a, stamina: 4 }, { ...sub, stamina: 6 }, pos.role, 0);
    const fit = bestStrengthMinute({ ...a, stamina: 8 }, { ...sub, stamina: 6 }, pos.role, 0);
    expect(weak.gain).toBeGreaterThan(fit.gain);
    expect(weak.minute).toBeLessThan(fit.minute);
  });

  it("Faustregel: schwächerer Ersatz kommt später oder gar nicht", () => {
    for (const r of ruleOfThumb()) {
      const [same, minus10, minus20] = r.minutes;
      expect(same).not.toBeNull();
      if (minus10 !== null) expect(minus10).toBeGreaterThanOrEqual(same!);
      if (minus20 !== null && minus10 !== null) expect(minus20).toBeGreaterThanOrEqual(minus10);
    }
    expect(ruleOfThumb([8], [0.8])[0].minutes[0]).toBeNull();
  });
});

describe("Auswechslungs-Vorschläge", () => {
  for (const mode of ["sieg", "ausgewogen", "training"] as const) {
    it(`${mode}: höchstens 3, jeder Spieler einmal, gültige HO-Anweisungen`, () => {
      const s = suggestSubstitutions({ lineup, byId, mode, training });
      expect(s.length).toBeLessThanOrEqual(MAX_SUBSTITUTIONS);
      expect(new Set(s.map((x) => x.playerOut)).size).toBe(s.length);
      expect(new Set(s.map((x) => x.playerIn)).size).toBe(s.length);
      for (const x of s) {
        expect(fieldIds.has(x.playerOut)).toBe(true);
        expect(benchIds.has(x.playerIn)).toBe(true);
        expect(x.text.length).toBeGreaterThan(10);
      }
      expect(orderProblems(s.map(suggestionToOrder), lineup, byId, 0).flat()).toEqual([]);
    });
  }

  it("Sieg: ohne Vorsprung-Bedingung nur Wechsel, die stärker machen", () => {
    for (const x of suggestSubstitutions({ lineup, byId, mode: "sieg", training })) {
      if (x.standing === SAFE_LEAD) expect(x.reason).toBe("einsatz");
      else expect(x.strengthPct).toBeGreaterThan(0);
    }
  });

  it("Ausgewogen verliert insgesamt höchstens 2 % Stärke", () => {
    const s = suggestSubstitutions({ lineup, byId, mode: "ausgewogen", training }).filter((x) => x.standing < 0);
    expect(s.reduce((a, x) => a + Math.min(0, x.strengthPct), 0)).toBeGreaterThanOrEqual(-2.0001);
  });

  it("Training: Minuten über 90 verfallen, also raus, sobald die Woche voll ist", () => {
    // Fixture trainiert Verteidigung: Innen- und Außenverteidiger (101 … 105) voll
    expect(training?.name).toBe("Verteidigung");
    const trained = lineup.positions.filter((p) => p.role >= 101 && p.role <= 105);
    const fresh = [...benchIds].find((id) => byId.get(id)!.keeper < 5)!;
    const week = new Map<number, WeekMinutes>(hrf.players.map((p) => [p.id, { full: 0, partly: 0, sources: [] }]));
    week.delete(fresh);
    // alle Verteidiger außer einem haben ihre 90 Minuten schon, einer hat 60
    trained.forEach((p, i) => week.set(p.playerId, { full: i === 0 ? 60 : 90, partly: 0, sources: [] }));
    const s = suggestSubstitutions({ lineup, byId, mode: "training", training, week });
    const pick = s.find((x) => x.playerIn === fresh)!;
    expect(pick.training).toBeGreaterThan(0);
    const out = week.get(pick.playerOut)!.full;
    expect(pick.minute).toBe(out >= 90 ? 1 : 90 - out);
    expect(pick.text).toMatch(/Trainingsminuten/);
  });

  it("zählt schon geplante Wechsel mit", () => {
    const first = suggestSubstitutions({ lineup, byId, mode: "training", training });
    const existing = first.slice(0, 2).map(suggestionToOrder);
    const rest = suggestSubstitutions({ lineup, byId, mode: "training", training, existing });
    expect(rest.length).toBeLessThanOrEqual(MAX_SUBSTITUTIONS - existing.length);
    for (const x of rest) expect(existing.some((o) => o.playerIn === x.playerIn || o.playerOut === x.playerOut)).toBe(false);
  });
});

describe("Alle einsetzen (einsatz)", () => {
  const isKeeper = (p: Player) => p.keeper > Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);
  const fresh = hrf.players.filter((p) => !fieldIds.has(p.id) && !isKeeper(p) && !(p.injury > 0)).slice(0, 4);
  const bench = { innerMidfield: fresh[0]?.id, winger: fresh[1]?.id, forward: fresh[2]?.id, centralDefender: fresh[3]?.id };
  const l = { ...lineup, bench };

  it("bringt bis zu 3 Bankspieler ohne Einsatz in dieser Woche", () => {
    const s = suggestSubstitutions({ lineup: l, byId, mode: "einsatz", training, week: new Map() });
    expect(s.length).toBe(MAX_SUBSTITUTIONS);
    expect(new Set(s.map((x) => x.playerOut)).size).toBe(s.length);
    for (const x of s) {
      expect(fresh.map((p) => p.id)).toContain(x.playerIn);
      expect(x.reason).toBe("einsatz");
      expect(x.standing).toBe(-1);
    }
  });

  it("lässt Bankspieler aus, die schon gespielt haben oder auf „Nicht trainieren“ stehen", () => {
    const week = new Map<number, WeekMinutes>([[fresh[0].id, { full: 0, partly: 0, sources: ["gespielt IV"] }]]);
    const noTrain = new Set([fresh[1].id]);
    const s = suggestSubstitutions({ lineup: l, byId, mode: "einsatz", training, week, noTrain });
    expect(s.map((x) => x.playerIn).sort()).toEqual([fresh[2].id, fresh[3].id].sort());
  });
});
