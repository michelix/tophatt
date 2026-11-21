import { describe, expect, it } from "vitest";
import DATA from "../src/i18n/translations.json";
import { createTranslator, fillTemplate, type Table } from "../src/ui/i18n-core";
import { detectLang } from "../src/ui/i18n";

const table: Table = {
  Kader: ["Squad", "Plantilla", "Rosa", "Kadra"],
  Mittelfeld: ["Midfield", "Medio campo", "Centrocampo", "Pomoc"],
  schwach: ["poor", "débil", "scarso", "słaby"],
  hoch: ["high", "alto", "alto", "wysoki"],
  "Nächstes Spiel": ["Next match", "Próximo partido", "Prossima partita", "Następny mecz"],
  Ligaspiel: ["League match", "Partido de liga", "Partita di campionato", "Mecz ligowy"],
  "{0}. Spieltag": ["Matchday {0}", "Jornada {0}", "{0}ª giornata", "{0}. kolejka"],
  "{0} von {1} verfügbar": ["{0} of {1} available", "{0} de {1} disponibles", "{0} su {1} disponibili", "{0} z {1} dostępnych"],
  "{0} Woche{1}": ["{0} week{1:s}", "{0} semana{1:s}", "{0} settiman{1:a|e}", "{0} tydz."],
};
const en = createTranslator(table, 0);
const it_ = createTranslator(table, 2);

describe("Sprachwahl", () => {
  it("nimmt die gespeicherte Wahl, sonst die Browsersprache, sonst Deutsch", () => {
    expect(detectLang("pl", ["en-US"])).toBe("pl");
    expect(detectLang("fr", ["es-AR", "en"])).toBe("es");
    expect(detectLang(null, ["fr-FR", "it-CH"])).toBe("it");
    expect(detectLang(null, ["pt-BR"])).toBe("de");
    expect(detectLang(null, [])).toBe("de");
  });
});

describe("Übersetzer", () => {
  it("übersetzt exakte Texte und lässt Unbekanntes und Leerraum stehen", () => {
    expect(en("  Kader ")).toBe("  Squad ");
    expect(en("SV Adlerhorst 1921")).toBe("SV Adlerhorst 1921");
    expect(en("12,5")).toBe("12,5");
  });
  it("setzt Werte in Muster ein und übersetzt sie mit", () => {
    expect(en("21 von 22 verfügbar")).toBe("21 of 22 available");
    expect(en("3. Spieltag")).toBe("Matchday 3");
  });
  it("Pluralendungen", () => {
    expect(fillTemplate("{0} week{1:s}", ["2", "n"])).toBe("2 weeks");
    expect(fillTemplate("{0} week{1:s}", ["1", ""])).toBe("1 week");
    expect(it_("1 Woche")).toBe("1 settimana");
    expect(it_("3 Wochen")).toBe("3 settimane");
  });
  it("zerlegt an Trennzeichen, Zahlen und Klammern", () => {
    expect(en("Mittelfeld · schwach (hoch)")).toBe("Midfield · poor (high)");
    expect(en("4 Kader")).toBe("4 Squad");
    expect(en("(schwach)")).toBe("(poor)");
  });
  it("ein Platzhalter überspannt keine Bausteine", () => {
    expect(en("Nächstes Spiel · Ligaspiel · 2. Spieltag")).toBe("Next match · League match · Matchday 2");
  });
});

describe("translations.json", () => {
  const strings = (DATA as { strings: Table }).strings;
  it("hat je Eintrag vier nicht leere Übersetzungen", () => {
    const bad = Object.entries(strings).filter(([, v]) => v.length !== 4 || v.some((x) => !x.trim()));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
  it("verwendet keine Platzhalter, die das Deutsche nicht hat", () => {
    // Weglassen ist erlaubt (deutsche Pluralendung "Woche{1}" braucht nicht jede Sprache).
    const nums = (s: string) => new Set(s.match(/\{\d+/g) ?? []);
    const bad = Object.entries(strings).filter(([k, v]) => v.some((x) => [...nums(x)].some((n) => !nums(k).has(n))));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});
