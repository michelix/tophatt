// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Sprachumschalter. Der Quelltext bleibt deutsch; diese Schicht übersetzt, was im DOM landet.
// Jeder deutsche Text ist sein eigener Schlüssel (src/i18n/translations.json). Texte mit
// eingesetzten Werten stehen dort als Muster mit {0}, {1}, … und werden per RegExp erkannt.
// So bleibt die Rechenlogik unberührt, und eine fehlende Übersetzung zeigt einfach Deutsch.

import DATA from "../i18n/translations.json";
import { setLocale } from "../core/locale";
import { createTranslator, fillTemplate } from "./i18n-core";

export type Lang = "de" | "en" | "es" | "it" | "pl";

/** Die fünf meistgenutzten Hattrick-Sprachen (siehe README). Reihenfolge = Spalten in translations.json. */
export const LANGS: readonly { code: Lang; name: string; locale: string }[] = [
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "en", name: "English", locale: "en-GB" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "pl", name: "Polski", locale: "pl-PL" },
];
const COLUMN: Record<Exclude<Lang, "de">, number> = { en: 0, es: 1, it: 2, pl: 3 };
const KEY = "tophatt.lang";

type Table = Record<string, readonly string[]>;
const table = (DATA as { strings: Table }).strings;

/** Gespeicherte Wahl, sonst die erste passende Browsersprache, sonst Deutsch. */
export function detectLang(stored: string | null, browser: readonly string[]): Lang {
  if (stored && LANGS.some((l) => l.code === stored)) return stored as Lang;
  for (const b of browser) {
    const code = b.toLowerCase().split("-")[0];
    if (LANGS.some((l) => l.code === code)) return code as Lang;
  }
  return "de";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let lang: Lang = detectLang(readStored(), typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]);

setLocale(LANGS.find((l) => l.code === lang)!.locale);

export const currentLang = () => lang;
/** Locale für Zahlen und Datumsangaben der gewählten Sprache. */
export const locale = () => LANGS.find((l) => l.code === lang)!.locale;

// --- Nachschlagen --------------------------------------------------------------------

const translators = new Map<Lang, (text: string) => string>();
function translatorFor(l: Exclude<Lang, "de">) {
  let tr = translators.get(l);
  if (!tr) translators.set(l, (tr = createTranslator(table, COLUMN[l])));
  return tr;
}
const column = (key: string, l: Exclude<Lang, "de">) => table[key]?.[COLUMN[l]] || undefined;
const fill = fillTemplate;

/** Übersetzt einen beliebigen Text; Leerraum am Rand bleibt erhalten. */
export function translateText(text: string, l: Lang = lang): string {
  return l === "de" ? text : translatorFor(l)(text);
}

/** Für Texte, die nicht im DOM landen (z. B. Dateinamen, Dialoge): deutscher Text mit {0}-Platzhaltern. */
export function t(de: string, ...args: (string | number)[]): string {
  const filled = fill(de, args.map(String));
  if (lang === "de") return filled;
  const tpl = column(de, lang);
  return tpl === undefined ? translateText(filled) : fill(tpl, args.map((a) => translateText(String(a))));
}

// --- DOM ------------------------------------------------------------------------------

const ATTRS = ["title", "aria-label", "placeholder", "alt"] as const;
/** Deutsches Original je Textknoten/Attribut, damit ein Sprachwechsel neu übersetzen kann. */
const originals = new WeakMap<Node, string>();
const attrOriginals = new WeakMap<Element, Map<string, string>>();
/** Was wir selbst geschrieben haben, damit der Observer es nicht als neues Original nimmt. */
const written = new WeakMap<Node, string>();

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);
const skipped = (el: Element | null) => !!el && (SKIP.has(el.tagName) || !!el.closest("[data-no-i18n]"));

function textNode(n: Text) {
  if (skipped(n.parentElement)) return;
  const cur = n.data;
  if (written.get(n) === cur) return;
  const orig = cur;
  originals.set(n, orig);
  const out = translateText(orig);
  if (out !== cur) {
    written.set(n, out);
    n.data = out;
  }
}

function attrs(el: Element) {
  if (el.tagName !== "TEXTAREA" && skipped(el)) return;
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    let map = attrOriginals.get(el);
    const mine = map?.get("w:" + a);
    if (mine === cur) continue;
    if (!map) attrOriginals.set(el, (map = new Map()));
    map.set(a, cur);
    const out = translateText(cur);
    if (out !== cur) {
      map.set("w:" + a, out);
      el.setAttribute(a, out);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (skipped(root as Element)) return;
    attrs(root as Element);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) textNode(n as Text);
    else attrs(n as Element);
  }
}

/** Alles neu aus den deutschen Originalen übersetzen (nach einem Sprachwechsel). */
function retranslate(root: Node) {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n: Node | null = root; n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const orig = originals.get(n);
      if (orig === undefined) continue;
      const out = translateText(orig);
      written.set(n, out);
      (n as Text).data = out;
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const map = attrOriginals.get(n as Element);
      if (!map) continue;
      for (const a of ATTRS) {
        const orig = map.get(a);
        if (orig === undefined) continue;
        const out = translateText(orig);
        map.set("w:" + a, out);
        (n as Element).setAttribute(a, out);
      }
    }
  }
}

let observer: MutationObserver | null = null;

/** Übersetzt die Seite und hält sie übersetzt, auch wenn später HTML neu gerendert wird. */
export function startI18n(root: HTMLElement = document.documentElement) {
  document.documentElement.lang = lang;
  walk(root);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach((n) => walk(n));
      else if (m.type === "characterData") textNode(m.target as Text);
      else if (m.type === "attributes") attrs(m.target as Element);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

/** Sprache wechseln und merken. `rerender` baut die datenabhängigen Teile neu (Zahlen-/Datumsformat). */
export function setLang(next: Lang, rerender?: () => void) {
  lang = next;
  setLocale(locale());
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ohne Speicher nur für diese Sitzung */
  }
  document.documentElement.lang = next;
  retranslate(document.documentElement);
  rerender?.();
}
