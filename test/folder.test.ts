import { describe, expect, it } from "vitest";
import { isHoExport, pickNewest } from "../src/ui/folder";

describe("neueste HRF-Datei", () => {
  it("überspringt eigene Exporte und andere Dateien", () => {
    expect(isHoExport("700025-2026-11-15.hrf")).toBe(true);
    expect(isHoExport("700025-2026-11-15-liga.hrf")).toBe(false);
    expect(isHoExport("700025-2026-11-15-freundschaft.hrf")).toBe(false);
    expect(isHoExport("notizen.txt")).toBe(false);
  });
  it("nimmt die zuletzt geänderte", () => {
    const f = pickNewest([
      { name: "a.hrf", lastModified: 100 },
      { name: "b.hrf", lastModified: 300 },
      { name: "c-liga.hrf", lastModified: 900 },
      { name: "d.HRF", lastModified: 200 },
    ]);
    expect(f?.name).toBe("b.hrf");
    expect(pickNewest([])).toBeNull();
  });
});
