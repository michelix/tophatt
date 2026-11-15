// Gegnerstärke: Bewertungen aus den Spielen des Gegners (HO lädt sie mit dem Gegnercheck) mitteln
// und den erwarteten eigenen Bewertungen gegenüberstellen.

import type { SectorRatings, RatingSector } from "./rating";

export interface MatchRating {
  matchId: number;
  type: number;
  date: Date;
  teamId: number;
  teamName: string;
  opponentName: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  ratings: SectorRatings;
  tactic: number;
  formation: string;
}

/** Hattrick-Bewertung (1 = katastrophal (sehr niedrig), 5 = erbärmlich (sehr niedrig) …) in die Skala von TopHatt (Stufe + Unterstufe/4) */
export const htToLevel = (r: number) => (r - 1) / 4 + 1;

type Row = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "number" ? v : 0);
const s = (v: unknown) => (typeof v === "string" ? v : "");

export function parseMatchRatings(rows: Row[]): MatchRating[] {
  const out: MatchRating[] = [];
  for (const r of rows) {
    for (const side of ["heim", "gast"] as const) {
      const other = side === "heim" ? "gast" : "heim";
      const v = (k: string) => htToLevel(n(r[side + k]));
      if (!n(r[side + "midfield"])) continue;
      out.push({
        matchId: n(r.matchid),
        type: n(r.matchtyp),
        date: new Date(s(r.spieldatum).replace(" ", "T")),
        teamId: n(r[side + "id"]),
        teamName: s(r[side + "name"]),
        opponentName: s(r[other + "name"]),
        home: side === "heim",
        goalsFor: n(r[side + "tore"]),
        goalsAgainst: n(r[other + "tore"]),
        ratings: {
          midfield: v("midfield"),
          defenceLeft: v("leftdef"),
          defenceCentral: v("middef"),
          defenceRight: v("rightdef"),
          attackLeft: v("leftatt"),
          attackCentral: v("midatt"),
          attackRight: v("rightatt"),
        },
        tactic: n(r[side + "tactictype"]),
        formation: s(r[side === "heim" ? "homeformation" : "awayformation"]),
      });
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export const TACTIC_DE: Record<number, string> = {
  0: "Normal",
  1: "Pressing",
  2: "Konter",
  3: "Angriff über die Mitte",
  4: "Angriff über die Flügel",
  7: "Kreatives Spiel",
  8: "Fernschüsse",
};

export interface OpponentProfile {
  teamId: number;
  matches: MatchRating[];
  average: SectorRatings;
  /** häufigste Formation und Taktik */
  formation: string;
  tactic: number;
}

/** Durchschnitt der letzten Pflichtspiele (Liga, Pokal; ohne Freundschaftsspiele) */
export function opponentProfile(all: MatchRating[], teamId: number, last = 5): OpponentProfile | null {
  const matches = all.filter((m) => m.teamId === teamId && [1, 2, 3].includes(m.type)).slice(0, last);
  if (!matches.length) return null;
  const keys = Object.keys(matches[0].ratings) as RatingSector[];
  const average = {} as SectorRatings;
  for (const k of keys) average[k] = matches.reduce((a, m) => a + m.ratings[k], 0) / matches.length;
  const mode = <T,>(xs: T[]) => [...xs].sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0];
  return { teamId, matches, average, formation: mode(matches.map((m) => m.formation)), tactic: mode(matches.map((m) => m.tactic)) };
}

export interface Duel {
  label: string;
  ours: number;
  theirs: number;
  /** Anteil für uns, 0..1 */
  share: number;
}

/**
 * Direkte Duelle: Mittelfeld gegen Mittelfeld (Ballbesitz), unser Angriff gegen ihre Abwehr und umgekehrt.
 * Unser rechter Angriff trifft auf ihre linke Abwehr.
 * Ballbesitz nach der bekannten Näherung mid³ / (mid³ + gegner³), Torchancen nach att / (att + def) (vereinfacht).
 */
export function duels(ours: SectorRatings, theirs: SectorRatings): Duel[] {
  const cube = (a: number, b: number) => a ** 3 / (a ** 3 + b ** 3);
  const ratio = (a: number, b: number) => a / (a + b);
  return [
    { label: "Ballbesitz (Mittelfeld)", ours: ours.midfield, theirs: theirs.midfield, share: cube(ours.midfield, theirs.midfield) },
    { label: "Unser Angriff rechts gegen ihre Abwehr links", ours: ours.attackRight, theirs: theirs.defenceLeft, share: ratio(ours.attackRight, theirs.defenceLeft) },
    { label: "Unser Angriff Mitte gegen ihre Abwehr Mitte", ours: ours.attackCentral, theirs: theirs.defenceCentral, share: ratio(ours.attackCentral, theirs.defenceCentral) },
    { label: "Unser Angriff links gegen ihre Abwehr rechts", ours: ours.attackLeft, theirs: theirs.defenceRight, share: ratio(ours.attackLeft, theirs.defenceRight) },
    { label: "Ihr Angriff rechts gegen unsere Abwehr links", ours: ours.defenceLeft, theirs: theirs.attackRight, share: ratio(ours.defenceLeft, theirs.attackRight) },
    { label: "Ihr Angriff Mitte gegen unsere Abwehr Mitte", ours: ours.defenceCentral, theirs: theirs.attackCentral, share: ratio(ours.defenceCentral, theirs.attackCentral) },
    { label: "Ihr Angriff links gegen unsere Abwehr rechts", ours: ours.defenceRight, theirs: theirs.attackLeft, share: ratio(ours.defenceRight, theirs.attackLeft) },
  ];
}

/** Grobe Einschätzung aus Ballbesitz und Chancenverwertung, keine Simulation */
export function verdict(d: Duel[], central = 1 / 3): { text: string; edge: number } {
  const poss = d[0].share;
  // Angriffe verteilt nach Taktik: central = Anteil durch die Mitte (Angriff über die Mitte/Flügel verschiebt ihn)
  const attack = central * d[2].share + ((1 - central) / 2) * (d[1].share + d[3].share);
  const defence = (d[4].share + d[5].share + d[6].share) / 3;
  // Chancen für uns ~ Ballbesitz × Angriff, Chancen für sie ~ (1-Ballbesitz) × (1-Abwehrquote)
  const us = poss * attack;
  const them = (1 - poss) * (1 - defence);
  const edge = us / (us + them);
  const text = edge > 0.6 ? "klarer Vorteil für uns" : edge > 0.52 ? "leichter Vorteil für uns" : edge >= 0.48 ? "ausgeglichen" : edge >= 0.4 ? "leichter Vorteil für den Gegner" : "klarer Vorteil für den Gegner";
  return { text, edge };
}
