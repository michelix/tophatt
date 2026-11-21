// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Reine Übersetzungslogik (ohne DOM), damit Tests und Werkzeuge sie direkt nutzen können.

export type Table = Record<string, readonly string[]>;

const PLACEHOLDER = /^\{\d+\}$/;
const LETTERS = /[A-Za-zÄÖÜäöüß]/;
/** Was in Textbausteinen zwischen übersetzbaren Teilen stehen darf. */
/** Satzgrenze, aber nicht bei Ordnungszahlen ("2. Spieltag", "1. Auswechslung"). */
const SENTENCE = /(?<=[.!?])(?<!\d\.(?=\s+(?:Spieltag|Auswechslung|Halbzeit|Liga|Spiel|Platz|Saison|Woche|Runde)\b))\s+(?=[A-ZÄÖÜ„(])/;
const STRONG = [" · ", " – "];
const SEPARATORS = [" · ", " – ", "; ", ": ", ", ", " / ", " + "];

/**
 * Setzt Werte ein. `{1:s}` schreibt "s", wenn Wert 1 nicht leer ist (deutsche Pluralendung wie
 * "Woche{1}" → "Wochen"), `{1:a|e}` wählt zwischen Einzahl und Mehrzahl.
 */
export function fillTemplate(tpl: string, args: readonly string[]): string {
  return tpl.replace(/\{(\d+)(?::([^}|]*)(?:\|([^}]*))?)?\}/g, (_, i: string, a?: string, b?: string) => {
    const v = args[Number(i)] ?? "";
    if (a === undefined) return v;
    const plural = v.trim() !== "";
    return b === undefined ? (plural ? a : "") : plural ? b : a;
  });
}

interface Pattern {
  re: RegExp;
  /** Platzhalter-Nummern in der Reihenfolge der Gruppen (Schlüssel beginnen nicht immer bei {0}). */
  nums: number[];
  /** Darf mehrere Sätze fassen: letzter Platzhalter nach ". " ("… auf der Bank. {2}") oder erster vor einem Satz ("{3} Balken = …") */
  rest: boolean[];
  hint: string;
  short: boolean;
  key: string;
}

/**
 * Liefert eine Funktion, die deutschen Text in die Spalte `col` übersetzt.
 * Reihenfolge: exakter Schlüssel, Muster mit {n}, dann Zerlegen an Trennzeichen,
 * Zahlen-Präfix/-Suffix und Klammerzusatz. Unbekanntes bleibt unverändert.
 */
export function createTranslator(table: Table, col: number): (text: string) => string {
  const value = (key: string) => {
    const v = table[key]?.[col];
    return v ? v : undefined;
  };
  const patterns: Pattern[] = [];
  for (const key of Object.keys(table)) {
    // Muster, die in dieser Sprache gleich lauten ("{0} HatStats{1}"), fangen sonst ganze Absätze ab.
    if (!/\{\d+\}/.test(key) || value(key) === undefined || value(key) === key) continue;
    const parts = key.split(/(\{\d+\})/);
    const re = new RegExp(
      "^" +
        parts
          .map((p, i) =>
            PLACEHOLDER.test(p)
              ? // direkt hinter einem Buchstaben und nur als {n:…} übersetzt: eine Endung ("Woche{1}" → "Wochen"), kein freier Text
                /[A-Za-zÄÖÜäöüß]$/.test(parts[i - 1] ?? "") && !table[key].some((v) => v.includes(p))
                ? "([a-zäöüß]{0,3})"
                : "([\\s\\S]*?)"
              : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("") +
        "$",
    );
    const hint = parts.filter((p) => !PLACEHOLDER.test(p)).reduce((a, b) => (b.length > a.length ? b : a), "");
    const nums = parts.filter((p) => PLACEHOLDER.test(p)).map((p) => Number(p.slice(1, -1)));
    const phIdx = parts.flatMap((p, i) => (PLACEHOLDER.test(p) ? [i] : []));
    const rest = phIdx.map(
      (i) =>
        (i === parts.length - 2 && parts[i + 1] === "" && /[.:]\s$/.test(parts[i - 1] ?? "")) ||
        (i === 1 && parts[0] === "" && /^\s[A-ZÄÖÜ„]/.test(parts[2] ?? "")),
    );
    patterns.push({ re, nums, rest, hint, key, short: key.replace(/\{\d+\}/g, "").trim().length < 12 });
  }
  // Muster mit mehr festem Text zuerst: sie sind spezifischer.
  const fixedLen = (k: string) => k.replace(/\{\d+\}/g, "").length;
  patterns.sort((a, b) => fixedLen(b.key) - fixedLen(a.key));
  const cache = new Map<string, string | null>();

  /** Nur exakte Muster mit {n}, ohne Zerlegen. */
  function matchPattern(text: string, depth: number): string | null {
    for (const p of patterns) {
      if (p.hint && !text.includes(p.hint)) continue;
      const m = p.re.exec(text);
      // Ein Platzhalter überspannt keine Bausteine ("Nächstes Spiel · Ligaspiel · 2. Spieltag") und keine Satzgrenze.
      if (!m || m.slice(1).some((a, i) => !p.rest[i] && (STRONG.some((s) => a.includes(s)) || SENTENCE.test(a)))) continue;
      // Kurze Muster ("{0} Platz") schlucken keine Aufzählungen ("nicht in Führung, eigener … vom Platz")
      if (p.short && m.slice(1).some((a) => a.includes(", ") || a.includes("; "))) continue;
      const args: string[] = [];
      p.nums.forEach((n, i) => (args[n] = part(m[i + 1], depth + 1)));
      const tpl = value(p.key)!;
      const out = fillTemplate(tpl, args);
      // Satzanfang bleibt groß, wenn die Übersetzung mit einem Wert beginnt ("Ein {0} …" → "{0} …")
      return tpl.startsWith("{") && /^[A-ZÄÖÜ]/.test(text) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
    }
    return null;
  }

  function core(text: string, depth: number, allowSplit = true): string | null {
    const exact = value(text);
    if (exact !== undefined) return exact;
    if (!LETTERS.test(text)) return null;
    if (!allowSplit) return matchPattern(text, depth);
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    let out = matchPattern(text, depth);
    if (out === null && depth < 6) out = split(text, depth);
    if (cache.size > 5000) cache.clear();
    cache.set(text, out);
    return out;
  }

  /** Teil eines größeren Texts: übersetzen, wenn möglich, sonst so lassen (Namen, Zahlen). */
  function part(text: string, depth: number): string {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    if (!m[2]) return text;
    const out = core(m[2], depth);
    return out === null ? text : m[1] + out + m[3];
  }

  function split(text: string, depth: number): string | null {
    // Satzzeichen vorn (Rest hinter einem fetten Namen): ": Weder Startelf noch Bank; …"
    let m = /^([:;,·–]\s+)(\S[\s\S]*)$/.exec(text);
    if (m) {
      const o = core(m[2], depth + 1);
      if (o !== null) return m[1] + o;
    }
    // Kurzes Etikett vor dem Text: "Ohne Änderungen: Es bleibt … – unter …", "Quirin Hasel, 34 Jahre: Torschuss verliert … Stufe. Nachfolger …"
    m = /^([^.!?:]{1,60}): ([\s\S]+)$/.exec(text);
    const whole = m ? core(m[2], depth + 1, false) : null;
    if (m && whole !== null) return `${part(m[1], depth + 1)}: ${whole}`;
    if (m && SENTENCE.test(m[2])) {
      const a = part(m[1], depth + 1);
      const b = part(m[2], depth + 1);
      if (a !== m[1] || b !== m[2]) return `${a}: ${b}`;
    }
    // Mehrere Sätze: möglichst lange bekannte Folgen übersetzen, sonst einzeln
    // (manche Schlüssel umfassen zwei Sätze: "… eine ganze Stufe. Nachfolger aufbauen oder kaufen.")
    const sentences = text.split(SENTENCE);
    if (sentences.length > 1) {
      const outs: string[] = [];
      let changed = false;
      for (let i = 0; i < sentences.length; ) {
        let j = i === 0 ? sentences.length - 1 : sentences.length;
        let hit: string | null = null;
        for (; j > i + 1; j--) {
          hit = core(sentences.slice(i, j).join(" "), depth + 1, false);
          if (hit !== null) break;
        }
        if (hit === null) {
          j = i + 1;
          const o = part(sentences[i], depth + 1);
          if (o !== sentences[i]) changed = true;
          outs.push(o);
        } else {
          changed = true;
          outs.push(hit);
        }
        i = j;
      }
      if (changed) return outs.join(" ");
    }
    for (const sep of SEPARATORS) {
      if (!text.includes(sep)) continue;
      const pieces = text.split(sep);
      const outs = pieces.map((p) => part(p, depth + 1));
      if (outs.some((o, i) => o !== pieces[i])) return outs.join(sep);
    }
    // Zahl/Zeichen vorn oder hinten: "3 Baustellen", "+ Verhalten", "Torwart 6,0", "1. Auswechslung"
    m = /^([+−±\-]?\s*[\d.,]+\.?\s+|[+−±•✦]\s+)(\S[\s\S]*)$/.exec(text);
    if (m) {
      const o = core(m[2], depth + 1);
      if (o !== null) return m[1] + o;
    }
    m = /^([\s\S]*?\S)(\s+[+−±\-]?[\d.,]+\s*%?|[:.])$/.exec(text);
    if (m) {
      const o = core(m[1], depth + 1);
      if (o !== null) return o + m[2];
    }
    // Ganz in Klammern: "(seit dem Trainingsupdate … niemand)"
    m = /^\(([^()]+)\)$/.exec(text);
    if (m) {
      const o = core(m[1], depth + 1);
      if (o !== null) return `(${o})`;
    }
    // Klammerzusatz: "schwach (hoch)", "A-Kader (Vorschlag)"
    m = /^([\s\S]*?\S)\s+\(([^()]+)\)$/.exec(text);
    if (m) {
      const a = part(m[1], depth + 1);
      const b = part(m[2], depth + 1);
      if (a !== m[1] || b !== m[2]) return `${a} (${b})`;
    }
    return null;
  }

  return (text: string) => {
    if (!LETTERS.test(text)) return text;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    const out = core(m[2].replace(/\s+/g, " "), 0);
    return out === null ? text : m[1] + out + m[3];
  };
}
