// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Taktikstärke und LoddarStats (aus HO RatingPredictionModel portiert) sowie die Wirkung von
// Spielort, Taktik, Einstellung und Ausrichtung gegenüber "Normal".

import { Attitude, type FieldPosition, type MatchSettings, type Player, Role, Tactic } from "./model";
import { RATING_SECTORS, type RatingSector, type SectorRatings, type TeamState, loyaltyBonus, skillRating, strength } from "./rating";
import { Evaluator, hatStatsOf } from "./optimizer";
import { SECTOR_DE } from "./weakness";

export const TACTIC_NAME: Record<number, string> = {
  [Tactic.normal]: "Normal",
  [Tactic.pressing]: "Pressing",
  [Tactic.counter]: "Kontern",
  [Tactic.attackMiddle]: "Angriff über die Mitte",
  [Tactic.attackWings]: "Angriff über die Flügel",
  [Tactic.creative]: "Kreatives Spiel",
  [Tactic.longShots]: "Fernschüsse",
};
export const ATTITUDE_NAME: Record<number, string> = { [Attitude.pic]: "Nicht so ernst nehmen", [Attitude.normal]: "Normal", [Attitude.mots]: "Spiel des Jahres" };
const STYLE_NAME: Record<number, string> = { [-10]: "defensiv", [-5]: "eher defensiv", 0: "ausgewogen", 5: "eher offensiv", 10: "offensiv" };

type Field = { player: Player; role: number }[];

/** Taktikstärke wie in HO (calcTacticsRating); null, wenn TopHatt sie nicht berechnet (Pressing) */
export function tacticLevel(field: Field, tactic: number): number | null {
  const players = field.map((f) => f.player);
  switch (tactic) {
    case Tactic.attackMiddle:
    case Tactic.attackWings: {
      // HO calcPassing: Summe (Treue + Passspiel) / 5 - 2
      const sum = players.reduce((s, p) => s + loyaltyBonus(p) + skillRating(p.passing), 0);
      return sum / 5 - 2;
    }
    case Tactic.counter: {
      // HO calcCounterAttack: nur Abwehrspieler, (2·Passspiel + Verteidigung) × Ø Form
      const d = field.filter((f) => f.role >= Role.rightBack && f.role <= Role.leftBack).map((f) => f.player);
      if (!d.length) return 0;
      let a = 0,
        form = 0;
      for (const p of d) {
        a += 2 * (loyaltyBonus(p) + skillRating(p.passing)) + loyaltyBonus(p) + skillRating(p.defending);
        form += p.form;
      }
      a *= form / d.length;
      return 0.017272 * a + 1.042313;
    }
    case Tactic.longShots: {
      const fp = field.filter((f) => f.role !== Role.keeper).map((f) => f.player);
      if (!fp.length) return 0;
      const sc = fp.reduce((s, p) => s + loyaltyBonus(p) + skillRating(p.scoring), 0);
      const sp = fp.reduce((s, p) => s + loyaltyBonus(p) + skillRating(p.setPieces), 0);
      return Math.max(0, (1.66 * sc + 0.55 * sp) / fp.length - 7.6);
    }
    case Tactic.creative: {
      let sum = 0;
      for (const f of field) {
        if (f.role === Role.keeper) continue;
        let c = 4 * strength(f.player, "passing") + skillRating(f.player.experience);
        if (f.player.specialty === 4) c *= 2; // unberechenbar
        sum += c;
      }
      return sum / 50;
    }
    case Tactic.normal:
      return 1;
    default:
      return null;
  }
}

const CENTRAL_WEIGHT = 0.37;

/** Anteil der Angriffe über die Mitte (HO LoddarStats-Gewichtung) */
export function centralShare(tactic: number, level: number | null): number {
  const l = level ?? 1;
  if (tactic === Tactic.attackMiddle) return CENTRAL_WEIGHT + (0.2 * (l - 1)) / 19 + 0.2;
  if (tactic === Tactic.attackWings) return CENTRAL_WEIGHT - ((0.2 * (l - 1)) / 19 + 0.2);
  return CENTRAL_WEIGHT;
}

const hq = (v: number) => {
  const x = Math.trunc((v - 1) * 4 + 1);
  return (2 * x) / (x + 80);
};

/** LoddarStats wie in HO (calcLoddarStats), mit den über 90 Minuten gemittelten Bewertungen */
export function loddarStats(r: SectorRatings, tactic: number, level: number | null): number {
  const DEFENSE_WEIGHT = 0.47;
  const ATTACK_WEIGHT = 1 - DEFENSE_WEIGHT;
  const WINGER_WEIGHT = (1 - CENTRAL_WEIGHT) / 2;
  const central = centralShare(tactic, level);
  const wing = (1 - central) / 2;
  const l = level ?? 1;
  const counter = tactic === Tactic.counter ? (0.25 * 2 * l) / (l + 20) : 0;
  const attack = (ATTACK_WEIGHT + counter) * (central * hq(r.attackCentral) + wing * (hq(r.attackLeft) + hq(r.attackRight)));
  const defence = DEFENSE_WEIGHT * (CENTRAL_WEIGHT * hq(r.defenceCentral) + WINGER_WEIGHT * (hq(r.defenceLeft) + hq(r.defenceRight)));
  return 80 * hq(r.midfield) * (defence + attack);
}

export interface SettingsEffect {
  /** Einstellungen, die von "Normal" abweichen, als Text */
  changed: string[];
  base: SectorRatings;
  now: SectorRatings;
  sectors: { sector: RatingSector; name: string; delta: number }[];
  hatStatsBase: number;
  hatStatsNow: number;
  loddarBase: number;
  loddarNow: number;
  level: number | null;
  /** Anteil der Angriffe durch die Mitte (normal 37 %) */
  central: number;
  notes: string[];
}

/**
 * Wirkung von Taktik, Einstellung und Ausrichtung gegenüber Normal, bei gleichem Spielort und gleicher Aufstellung.
 * Der Spielort steht fest (kommt aus dem Spielplan), seine Wirkung wird als Hinweis erklärt.
 */
export function settingsEffect(positions: FieldPosition[], byId: Map<number, Player>, settings: MatchSettings, team: TeamState): SettingsEffect {
  const field = positions.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour }));
  const neutral: MatchSettings = { ...settings, tactic: Tactic.normal, attitude: Attitude.normal, styleOfPlay: 0 };
  const base = new Evaluator(neutral, team).ratings(field);
  const now = new Evaluator(settings, team).ratings(field);
  const level = tacticLevel(field, settings.tactic);
  const changed: string[] = [];
  if (settings.tactic !== Tactic.normal) changed.push(`Taktik ${TACTIC_NAME[settings.tactic]}`);
  if (settings.attitude !== Attitude.normal) changed.push(`Einstellung ${ATTITUDE_NAME[settings.attitude]}`);
  if (settings.styleOfPlay !== 0) changed.push(`Ausrichtung ${STYLE_NAME[settings.styleOfPlay] ?? settings.styleOfPlay}`);
  const notes: string[] = [];
  const central = centralShare(settings.tactic, level);
  if (settings.tactic === Tactic.attackMiddle || settings.tactic === Tactic.attackWings)
    notes.push(
      `${TACTIC_NAME[settings.tactic]} ändert nicht die Angriffsbewertungen, sondern lenkt die Angriffe: ${Math.round(central * 100)} % laufen durch die Mitte statt 37 %, ` +
        `je ${Math.round(((1 - central) / 2) * 100)} % über jeden Flügel. Taktikstärke ${level!.toFixed(1)} (aus Passspiel und Treue der Elf).`,
    );
  if (settings.tactic === Tactic.counter)
    notes.push(`Kontern bringt zusätzliche Chancen, wenn der Gegner mehr Ballbesitz hat. Konterstärke ${level!.toFixed(1)} (aus Passspiel, Verteidigung und Form der Abwehr).`);
  if (settings.tactic === Tactic.longShots) notes.push(`Fernschussstärke ${level!.toFixed(1)} (aus Torschuss und Standards der Feldspieler).`);
  if (settings.tactic === Tactic.creative) notes.push(`Kreativ erhöht die Zahl der Sonderereignisse. Stärke ${level!.toFixed(1)} (aus Passspiel und Erfahrung, unberechenbare Spieler zählen doppelt).`);
  if (settings.tactic === Tactic.pressing) notes.push("Pressing nimmt dem Gegner Chancen, kostet aber Kondition (in den Bewertungen enthalten). Die Pressingstärke berechnet TopHatt nicht.");
  if (settings.attitude === Attitude.mots) notes.push("Spiel des Jahres senkt danach für einige Wochen die Stimmung. Nur für entscheidende Spiele.");
  if (settings.attitude === Attitude.pic) notes.push("Nicht so ernst nehmen hebt danach die Stimmung, das Spiel selbst wird aber schwerer.");
  const loc = settings.location === 1 ? "Heimspiel: Mittelfeld +20 %." : settings.location === 2 ? "Auswärts-Derby: Mittelfeld +11 %." : "Auswärtsspiel: kein Heimvorteil.";
  notes.push(`Spielort ist in allen Werten enthalten (${loc})`);
  return {
    changed,
    base,
    now,
    sectors: RATING_SECTORS.map((s) => ({ sector: s, name: SECTOR_DE[s], delta: now[s] - base[s] })),
    hatStatsBase: hatStatsOf(base),
    hatStatsNow: hatStatsOf(now),
    loddarBase: loddarStats(base, Tactic.normal, 1),
    loddarNow: loddarStats(now, settings.tactic, level),
    level,
    central,
    notes,
  };
}
