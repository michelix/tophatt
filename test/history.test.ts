import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { archiveCsv, diffWeeks, emptyArchive, mergeArchives, mergeSnapshot, parseArchive, serializeArchive, snapshotFromHrf, weekMetrics, weekOf } from "../src/core/history";

const text = readFileSync("test/fixtures/team.hrf", "utf8");

/** HRF-Text mit geänderten Werten (Schlüssel=Wert, nur erstes Vorkommen) */
const patch = (t: string, edits: Record<string, string>) => {
  let out = t;
  for (const [k, v] of Object.entries(edits)) out = out.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`);
  return out;
};

describe("Verlauf", () => {
  it("ordnet Zeitpunkte der Trainingswoche ab Freitag zu", () => {
    expect(weekOf(new Date(2026, 10, 20, 0, 31))).toBe("2026-11-20"); // Freitag
    expect(weekOf(new Date(2026, 10, 21, 9, 0))).toBe("2026-11-20"); // Samstag
    expect(weekOf(new Date(2026, 10, 26, 23, 0))).toBe("2026-11-20"); // Donnerstag
    expect(weekOf(new Date(2026, 10, 15, 12, 0))).toBe("2026-11-13"); // Sonntag
  });

  it("liest Training, Personal, Mannschaft und Kader aus der HRF", () => {
    const s = snapshotFromHrf(text)!;
    expect(s.week).toBe("2026-11-13");
    expect(s.training).toEqual({ type: 3, typeName: "Verteidigung", intensity: 100, staminaShare: 15 });
    expect(s.staff.trainerLevel).toBe(3);
    expect(s.staff.trainerType).toBe(2);
    expect(s.staff.assistants).toBe(1);
    expect(s.staff.medics).toBe(3);
    expect(s.staff.members).toHaveLength(2);
    expect(s.staff.costPerWeek).toBe(6500); // 5000 € + 1500 €, Trainergehalt fehlt in den Testdaten
    expect(s.finance).toBeNull(); // Testdaten ohne Finanzen
    expect(s.team.leaguePosition).toBe(2);
    expect(s.team.points).toBe(3);
    expect(s.squad.length).toBeGreaterThan(20);
    expect(s.squad.some((p) => p.name.includes("Trainer"))).toBe(false);
  });

  it("behält je Woche den neuesten Download, Notizen und Planwerte bleiben", () => {
    const a = emptyArchive();
    const first = snapshotFromHrf(text)!;
    expect(mergeSnapshot(a, { ...first, note: "Plan: Verteidigung bis Saisonende", plans: { trainerPlan: { trainerLevel: 4 } } })).toBe(true);
    expect(mergeSnapshot(a, first)).toBe(false);
    const later = snapshotFromHrf(patch(text, { date: "2026-11-15 18:00:00", trLevel: "90" }))!;
    expect(mergeSnapshot(a, later)).toBe(true);
    expect(a.weeks).toHaveLength(1);
    expect(a.weeks[0].training.intensity).toBe(90);
    expect(a.weeks[0].note).toBe("Plan: Verteidigung bis Saisonende");
    expect(a.weeks[0].plans).toEqual({ trainerPlan: { trainerLevel: 4 } });
    // älterer Download derselben Woche überschreibt nichts
    expect(mergeSnapshot(a, first)).toBe(false);
    expect(a.weeks[0].training.intensity).toBe(90);
  });

  it("zeigt Änderungen von Einstellungen und Fähigkeitsaufstiege", () => {
    const w1 = snapshotFromHrf(text)!;
    const firstPlayer = w1.squad[0];
    const lines = text.split(/\r?\n/);
    const head = lines.findIndex((l) => l === `[player${firstPlayer.id}]`);
    const defIdx = lines.findIndex((l, i) => i > head && l.startsWith("bac="));
    lines[defIdx] = `bac=${firstPlayer.defending + 1}`;
    const t2 = patch(lines.join("\n"), { date: "2026-11-20 08:00:00", trTypeValue: "8", trType: "Spielaufbau", hjTranare: "4", placering: "1" })
      .replace("staff1StaffLevel=1", "staff1StaffLevel=4")
      .replace("staff1Cost=15000", "staff1Cost=55800");
    const w2 = snapshotFromHrf(t2)!;
    expect(w2.week).toBe("2026-11-20");
    const ch = diffWeeks(w1, w2);
    const labels = ch.map((c) => c.label);
    expect(labels).toContain("Trainingsart");
    expect(ch.find((c) => c.label === "Trainingsart")).toMatchObject({ from: "Verteidigung", to: "Spielaufbau" });
    expect(ch.find((c) => c.label === "Assistenztrainer (Stufen)")).toMatchObject({ from: "1", to: "4", tone: 1 });
    expect(ch.find((c) => c.label === "Personalkosten pro Woche")).toMatchObject({ tone: -1 });
    expect(ch.find((c) => c.label === "Tabellenplatz")).toMatchObject({ from: "2.", to: "1.", tone: 1 });
    expect(ch.find((c) => c.kind === "skill")).toMatchObject({ label: `${firstPlayer.name}: Verteidigung`, tone: 1 });

    const a = emptyArchive();
    mergeSnapshot(a, w2);
    mergeSnapshot(a, w1);
    expect(a.weeks.map((w) => w.week)).toEqual(["2026-11-13", "2026-11-20"]);
    const m = weekMetrics(a.weeks);
    expect(m[0].skillUps).toBeNull();
    expect(m[1].skillUps).toBe(1);
    expect(m[1].staffCost).toBe(10580);
    const csv = archiveCsv(a.weeks);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("2026-11-20;96;");
  });

  it("überlebt Export und Import und verwirft kaputte Daten", () => {
    const a = emptyArchive();
    mergeSnapshot(a, snapshotFromHrf(text)!);
    const back = parseArchive(serializeArchive(a));
    expect(back.weeks).toHaveLength(1);
    const b = emptyArchive();
    expect(mergeArchives(b, back)).toBe(1);
    expect(mergeArchives(b, back)).toBe(0);
    expect(parseArchive("kein json").weeks).toEqual([]);
    expect(parseArchive('{"weeks":[{"week":1}]}').weeks).toEqual([]);
  });

  it("lehnt Dateien ohne Spieler ab", () => {
    expect(snapshotFromHrf("[basics]\ndate=2026-11-15 10:00:00")).toBeNull();
  });
});
