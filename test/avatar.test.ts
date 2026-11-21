import { describe, expect, it } from "vitest";
import { parseHoData } from "../src/core/hodata";
import { avatarHtml, ownAvatarSvg } from "../src/ui/avatar";

describe("Spielerbilder", () => {
  it("liest HO-Bilder aus dem Sync und verwirft ungültige", () => {
    const d = parseHoData(JSON.stringify({ avatars: [{ spielerid: 7, png: "iVBORw0KGgo=" }, { spielerid: 8, png: "<script>" }, { spielerid: 0, png: "AAAA" }] }));
    expect([...d.avatars.keys()]).toEqual([7]);
    expect(d.avatars.get(7)).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
  it("ohne HO-Bild: eigenes Bild, fest je Spieler-ID", () => {
    const strip = (s: string) => s.replace(/avc\d+/g, "x");
    expect(strip(ownAvatarSvg(4711, 8))).toBe(strip(ownAvatarSvg(4711, 8)));
    expect(strip(ownAvatarSvg(4711, 8))).not.toBe(strip(ownAvatarSvg(4712, 8)));
    expect(ownAvatarSvg(4711, 8)).toContain(">8</text>");
    expect(avatarHtml(5, new Map([[5, "data:image/png;base64,AAAA"]]))).toContain("<img");
    expect(avatarHtml(6, new Map())).toContain("<svg");
  });
});
