// Spielerbild: das Bild aus HO (img/playersAvatar, über den Sync), sonst ein eigenes TopHatt-Bild.
// Das eigene Bild ist neu gezeichnet: Gesicht, Haare und Hautton fest aus der Spieler-ID,
// Trikot in Vereinsfarben (lila/gold) mit Rückennummer.

const SKIN = ["#f2c9a5", "#e8b48c", "#d39a6e", "#b97a4f", "#8d5a3a", "#f6d6bc"];
const HAIR = ["#2b2118", "#5a3b22", "#8a5a2b", "#c8913f", "#e3c36b", "#9a3b1f", "#1d1d1f", "#b9b4ab"];

/** kleiner fester Zufallsgenerator (xorshift) aus der Spieler-ID */
function rng(id: number): () => number {
  let x = Math.imul(id || 1, 2654435761) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

let clipSeq = 0;

/** Eigenes Spielerbild als SVG (Seitenverhältnis 3:4 wie HO) */
export function ownAvatarSvg(id: number, number = 0, bg = true): string {
  const r = rng(id);
  r();
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const skin = pick(SKIN);
  const hairC = pick(HAIR);
  const hairT = Math.floor(r() * 6);
  const beard = r() < 0.3;
  const jersey = "#5b2a86",
    trim = "#e5b53a";
  const eyeY = 52;
  let hair: string;
  switch (hairT) {
    case 0:
      hair = `<path d="M24 50C22 28 34 18 46 18C60 18 70 28 68 50C66 40 60 33 46 33C33 33 27 40 24 50Z" fill="${hairC}"/>`;
      break;
    case 1:
      hair = `<path d="M23 54C20 26 34 16 48 17C62 18 72 30 69 54L66 42C58 36 44 28 30 34Z" fill="${hairC}"/>`;
      break;
    case 2:
      hair = [[30, 30], [38, 24], [47, 22], [56, 24], [63, 30], [26, 40], [67, 40], [34, 28], [60, 27]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${hairC}"/>`).join("");
      break;
    case 3:
      hair = `<path d="M22 70C16 30 32 16 46 16C62 16 76 30 70 70L66 70C68 48 62 34 46 34C32 34 26 48 26 70Z" fill="${hairC}"/>`;
      break;
    case 4:
      hair = `<path d="M27 40C30 30 37 26 46 26C55 26 62 30 65 40" fill="none" stroke="${hairC}" stroke-width="3" opacity=".5"/>`;
      break;
    default:
      hair = `<path d="M38 34L40 14L46 20L52 14L54 34Z" fill="${hairC}"/><path d="M26 46C26 36 34 30 46 30C58 30 66 36 66 46C60 40 32 40 26 46Z" fill="${hairC}" opacity=".85"/>`;
  }
  const beardP = beard ? `<path d="M29 58C30 80 40 86 46 86C52 86 62 80 63 58C60 70 54 74 46 74C38 74 32 70 29 58Z" fill="${hairC}"/>` : "";
  const cid = `avc${++clipSeq}`;
  return `<svg class="avatar-own" viewBox="0 0 92 123" aria-hidden="true"><defs><clipPath id="${cid}"><rect width="92" height="123" rx="10"/></clipPath></defs><g clip-path="url(#${cid})">
${bg ? `<rect width="92" height="123" fill="#e3e9ef"/>` : ""}
<path d="M6 123C8 100 20 92 46 92C72 92 84 100 86 123Z" fill="${jersey}"/>
<path d="M36 92L46 104L56 92" fill="none" stroke="${trim}" stroke-width="4" stroke-linejoin="round"/>
<path d="M10 112L20 104M82 112L72 104" stroke="${trim}" stroke-width="3"/>
${number > 0 && number < 100 ? `<text x="46" y="120" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="13" fill="${trim}">${number}</text>` : ""}
<rect x="38" y="76" width="16" height="18" rx="6" fill="${skin}"/>
<ellipse cx="24.5" cy="${eyeY + 4}" rx="4" ry="6" fill="${skin}"/><ellipse cx="67.5" cy="${eyeY + 4}" rx="4" ry="6" fill="${skin}"/>
<rect x="25" y="26" width="42" height="56" rx="20" fill="${skin}"/>
${hair}${beardP}
<path d="M34 ${eyeY - 6}h8M50 ${eyeY - 6}h8" stroke="#2a2a2a" stroke-width="2.4" stroke-linecap="round"/>
<circle cx="38" cy="${eyeY}" r="2.6" fill="#1f2328"/><circle cx="54" cy="${eyeY}" r="2.6" fill="#1f2328"/>
<path d="M46 ${eyeY + 3}l-2 8h4" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M40 ${eyeY + 17}q6 ${beard ? 2 : 4} 12 0" fill="none" stroke="${beard ? "#f4e9e0" : "#7a3b2e"}" stroke-width="2.2" stroke-linecap="round"/>
</g></svg>`;
}

/** Bild für einen Spieler: HO-Bild, wenn vorhanden, sonst das eigene */
export function avatarHtml(id: number, avatars: Map<number, string> | undefined, number = 0, bg = true): string {
  const src = avatars?.get(id);
  return src && src.startsWith("data:image/png;base64,") ? `<img class="avatar-ho" src="${src}" alt="" draggable="false">` : ownAvatarSvg(id, number, bg);
}

/** Himmelblau des HO-Hintergrunds (Verlauf etwa 66ccff bis b7e7ff) */
export const isSky = (r: number, g: number, b: number, a = 255) => a < 20 || (b >= 235 && g >= 185 && r <= 205 && g - r >= 20);

/**
 * HO-Bilder freistellen: den blauen Hintergrund vom Rand her (Flutfüllung) durchsichtig machen,
 * damit die Figur wie auf Hattrick auf der Fläche steht – hier in der Kaderfarbe.
 * Blaue Stellen im Trikot bleiben, weil sie nicht mit dem Rand verbunden sind.
 */
export async function cutoutAvatars(avatars: Map<number, string>): Promise<void> {
  if (typeof document === "undefined" || !avatars.size) return;
  await Promise.all(
    [...avatars].map(async ([id, src]) => {
      try {
        const img = new Image();
        img.src = src;
        await img.decode();
        const w = img.naturalWidth,
          h = img.naturalHeight;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h);
        const d = data.data;
        const seen = new Uint8Array(w * h);
        const stack: number[] = [];
        for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
        for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
        while (stack.length) {
          const i = stack.pop()!;
          if (seen[i]) continue;
          seen[i] = 1;
          const k = i * 4;
          if (!isSky(d[k], d[k + 1], d[k + 2], d[k + 3])) continue;
          d[k + 3] = 0;
          const x = i % w;
          if (x > 0) stack.push(i - 1);
          if (x < w - 1) stack.push(i + 1);
          if (i >= w) stack.push(i - w);
          if (i < w * (h - 1)) stack.push(i + w);
        }
        ctx.putImageData(data, 0, 0);
        avatars.set(id, c.toDataURL("image/png"));
      } catch {
        /* Bild bleibt wie aus HO */
      }
    }),
  );
}
