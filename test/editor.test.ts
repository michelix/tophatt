import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHrf, writeLineupToHrf } from "../src/core/hrf";
import { completeLineup } from "../src/core/editor";
import { defaultMatchSettings } from "../src/core/model";
import { HATSTATS_OBJECTIVE, optimizeLineup } from "../src/core/optimizer";

const hrf = parseHrf(readFileSync(new URL("./fixtures/team.hrf", import.meta.url), "utf8"));
const team = { teamSpirit: hrf.team.teamSpirit, confidence: hrf.team.confidence };
const best = optimizeLineup(hrf.players, defaultMatchSettings, team, { formationExperience: hrf.team.formationExperience, objective: HATSTATS_OBJECTIVE, tryBehaviours: false, minFormationExperience: 6, allowBruised: false });
const positions = best.lineup.positions;
const auto = completeLineup(positions, hrf.players, defaultMatchSettings, false);
const onField = new Set(positions.map((p) => p.playerId));
const free = hrf.players.filter((p) => !onField.has(p.id) && p.injury < 0 && p.cards < 3);

describe("Kapitän, Standards und Bank selbst wählen", () => {
  it("ohne Wahl bleibt alles automatisch", () => {
    expect(completeLineup(positions, hrf.players, defaultMatchSettings, false, {})).toEqual(auto);
  });

  it("übernimmt Kapitän und Standardschützen, solange sie auf dem Feld stehen", () => {
    const other = positions.find((p) => p.playerId !== auto.captainId && p.playerId !== auto.setPiecesId)!.playerId;
    const c = completeLineup(positions, hrf.players, defaultMatchSettings, false, { captainId: other, setPiecesId: other });
    expect(c.captainId).toBe(other);
    expect(c.setPiecesId).toBe(other);
    const benchOnly = free[0].id;
    const d = completeLineup(positions, hrf.players, defaultMatchSettings, false, { captainId: benchOnly });
    expect(d.captainId).toBe(auto.captainId);
  });

  it("setzt einen gewählten Bankspieler fest und füllt den Rest ohne Doppelte", () => {
    const pick = free.find((p) => !Object.values(auto.bench).includes(p.id)) ?? free[0];
    const c = completeLineup(positions, hrf.players, defaultMatchSettings, false, { bench: { forward: pick.id } });
    expect(c.bench.forward).toBe(pick.id);
    const ids = Object.values(c.bench);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => onField.has(id!))).toBe(false);
  });

  it("0 lässt einen Bankplatz leer, ein Feldspieler auf der Bank wird ignoriert", () => {
    const c = completeLineup(positions, hrf.players, defaultMatchSettings, false, { bench: { keeper: 0, winger: positions[3].playerId } });
    expect(c.bench.keeper).toBeUndefined();
    expect(c.bench.winger).not.toBe(positions[3].playerId);
    expect(c.bench.winger).toBeDefined();
  });

  it("schreibt die gewählte Bank und den Kapitän in die HRF-Datei für HO", () => {
    const pick = free[free.length - 1];
    const cap = positions[5].playerId;
    const c = completeLineup(positions, hrf.players, defaultMatchSettings, false, { captainId: cap, bench: { extra: pick.id } });
    const text = writeLineupToHrf(hrf, c, 123, 1);
    expect(text).toMatch(new RegExp(`^captain=${cap}$`, "m"));
    expect(text).toMatch(new RegExp(`^substxt1=${pick.id}$`, "m"));
  });
});
