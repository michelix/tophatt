// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Reine Übersetzungslogik (ohne DOM), damit Tests und Werkzeuge sie direkt nutzen können.

export type Table = Record<string, readonly string[]>;

const PLACEHOLDER = /^\{\d+\}$/;
const LETTERS = /[A-Za-zÄÖÜäöüß]/;
/** Was in Textbausteinen zwischen übersetzbaren Teilen stehen darf. */
const STRONG = [" · ", " – "];
const SEPARATORS = [" · ", " – ", "; ", ", ", ": ", " / ", " + "];

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
  hint: string;
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
    if (!/\{\d+\}/.test(key) || value(key) === undefined) continue;
    const parts = key.split(/(\{\d+\})/);
    const re = new RegExp(
      "^" + parts.map((p) => (PLACEHOLDER.test(p) ? "([\\s\\S]*?)" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("") + "$",
    );
    const hint = parts.filter((p) => !PLACEHOLDER.test(p)).reduce((a, b) => (b.length > a.length ? b : a), "");
    patterns.push({ re, hint, key });
  }
  // Muster mit mehr festem Text zuerst: sie sind spezifischer.
  const fixedLen = (k: string) => k.replace(/\{\d+\}/g, "").length;
  patterns.sort((a, b) => fixedLen(b.key) - fixedLen(a.key));
  const cache = new Map<string, string | null>();

  function core(text: string, depth: number): string | null {
    const exact = value(text);
    if (exact !== undefined) return exact;
    if (!LETTERS.test(text)) return null;
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    let out: string | null = null;
    for (const p of patterns) {
      if (p.hint && !text.includes(p.hint)) continue;
      const m = p.re.exec(text);
      // Ein Platzhalter überspannt keine Bausteine ("Nächstes Spiel · Ligaspiel · 2. Spieltag").
      if (!m || m.slice(1).some((a) => STRONG.some((s) => a.includes(s)))) continue;
      const args = m.slice(1).map((a) => part(a, depth + 1));
      out = fillTemplate(value(p.key)!, args);
      break;
    }
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
    // Mehrere Sätze: einzeln übersetzen ("Wird stärker (…). Reserve … erreicht nur …")
    const sentences = text.split(/(?<!\d\.)(?<=[.!?])\s+(?=[A-ZÄÖÜ„(])/);
    if (sentences.length > 1) {
      const outs = sentences.map((p) => part(p, depth + 1));
      if (outs.some((o, i) => o !== sentences[i])) return outs.join(" ");
    }
    for (const sep of SEPARATORS) {
      if (!text.includes(sep)) continue;
      const pieces = text.split(sep);
      const outs = pieces.map((p) => part(p, depth + 1));
      if (outs.some((o, i) => o !== pieces[i])) return outs.join(sep);
    }
    // Zahl/Zeichen vorn oder hinten: "3 Baustellen", "+ Verhalten", "Torwart 6,0", "1. Auswechslung"
    let m = /^([+−±\-]?\s*[\d.,]+\.?\s+|[+−±•✦]\s+)(\S[\s\S]*)$/.exec(text);
    if (m) {
      const o = core(m[2], depth + 1);
      if (o !== null) return m[1] + o;
    }
    m = /^([\s\S]*?\S)(\s+[+−±\-]?[\d.,]+\s*%?|:)$/.exec(text);
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
