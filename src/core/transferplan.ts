// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Transferplan: ein gemeinsames Budget für alle Suchprofile, das den Finanz-Puffer über eine Saison hält,
// eine Kaufreihenfolge nach Nutzen und die Wirkung geplanter Käufe und Verkäufe auf den Kontostand.

import type { Advice, UpgradeHint } from "./advisor";
import { DEFAULT_HORIZON, type FinanceSnapshot, type NormalWeek } from "./finance";
import type { HoTransfer } from "./hodata";
import type { Player } from "./model";
import type { SearchProfile } from "./scouting";

/** Bereits geplante Ausgaben: einmalig (Kaufpreise minus Verkaufserlöse) und pro Woche (Gehälter minus Ersparnis) */
export interface Commitment {
  oneTime: number;
  weekly: number;
}

export const NO_COMMITMENT: Commitment = { oneTime: 0, weekly: 0 };

/** Hattrick: Spieler im Ausland verdienen 20 % mehr */
export const FOREIGN_SALARY_FACTOR = 1.2;

/**
 * Größter Kaufpreis für einen Spieler mit Gehalt `salary`, gekauft in `atWeek` Wochen (0 = jetzt), bei dem der
 * Kontostand ab dem Kauf eine ganze Saison lang über dem Puffer bleibt. Andere geplante Käufe und Verkäufe
 * (`c`) gelten ab sofort. Ergebnis auf 1.000 € abgerundet, nie negativ.
 */
export function maxPrice(
  s: Pick<FinanceSnapshot, "expectedCash">,
  normal: Pick<NormalWeek, "total">,
  buffer: number,
  c: Commitment,
  salary: number,
  atWeek = 0,
  weeks = DEFAULT_HORIZON,
): number {
  let m = Infinity;
  // Kontostand nach Woche w (0 = nach dem nächsten Update), Kauf in Woche atWeek
  for (let w = atWeek; w < atWeek + weeks; w++) {
    const cash = s.expectedCash - c.oneTime - c.weekly * (w + 1) + normal.total * w - salary * (w - atWeek + 1);
    m = Math.min(m, cash - buffer);
  }
  return Math.max(0, Math.floor(m / 1000) * 1000);
}

const best = (p: Player) => Math.max(p.keeper, p.defending, p.playmaking, p.winger, p.scoring, p.passing);

/**
 * Gehalt eines Spielers mit Hauptfertigkeit `level`, geschätzt aus den Gehältern des eigenen Kaders
 * (exponentiell je Stufe, wie Hattrick-Gehälter wachsen) plus 20 % für einen Spieler aus dem Ausland.
 * Jugendspieler unter 19 haben Sonderverträge und zählen nicht.
 */
export function estimateSalary(players: Player[], level: number): number {
  const pts = players.filter((p) => p.age >= 19 && p.salary > 0).map((p) => ({ x: best(p), y: Math.log(p.salary) }));
  let a: number;
  let b = Math.log(1.6);
  if (pts.length >= 3) {
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const fit = sxx > 0 ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
    // ein Kader mit wenig Spannweite liefert keine verlässliche Steigung
    if (fit > Math.log(1.2) && fit < Math.log(3)) b = fit;
    a = my - b * mx;
  } else if (pts.length) {
    a = pts.reduce((s, p) => s + p.y - b * p.x, 0) / pts.length;
  } else {
    a = Math.log(300) - b * 6;
  }
  return Math.round((Math.exp(a + b * level) * FOREIGN_SALARY_FACTOR) / 10) * 10;
}

export interface RankedProfile {
  profile: SearchProfile;
  /** HatStats-Zuwachs (+2 Stufen auf der Position), null = langfristig, wirkt erst später */
  gain: number | null;
  /** Zuwachs kommt in einer Schwachstelle an */
  helpsWeak: boolean;
  /** geschätztes Gehalt pro Woche */
  salary: number;
  /** Zielstufe der Hauptfertigkeit (Obergrenze des Suchprofils) */
  level: number;
}

/**
 * Kaufreihenfolge: zuerst Verstärkungen für sofort, die in einer Schwachstelle ankommen (größter Zuwachs zuerst),
 * dann übrige Verstärkungen nach HatStats, zuletzt Nachfolger zum Aufbauen in der Reihenfolge der Suchprofile.
 */
export function rankProfiles(profiles: SearchProfile[], advice: Pick<Advice, "allUpgrades"> | null, players: Player[]): RankedProfile[] {
  const ups: UpgradeHint[] = advice?.allUpgrades ?? [];
  const ranked = profiles.map((profile, i) => {
    const main = profile.skills[0];
    const level = main.max ?? main.min;
    const u = ups.filter((x) => x.group === profile.group && x.skillKey === main.skill).sort((a, z) => z.weakGain - a.weakGain || z.gainPlus2 - a.gainPlus2)[0];
    const helpsWeak = !!u && u.weakGain > 0.05;
    const gain = profile.kind === "sofort" ? (u ? Math.max(0, helpsWeak ? u.weakGain : u.gainPlus2) : 0) : null;
    return { r: { profile, gain, helpsWeak, salary: estimateSalary(players, level), level } as RankedProfile, i };
  });
  const cls = (r: RankedProfile) => (r.gain === null ? 2 : r.helpsWeak ? 0 : 1);
  ranked.sort((a, z) => cls(a.r) - cls(z.r) || (z.r.gain ?? 0) - (a.r.gain ?? 0) || a.r.profile.priority - z.r.profile.priority || a.i - z.i);
  return ranked.map((x) => x.r);
}

export interface TransferTotals {
  bought: number;
  sold: number;
  spent: number;
  earned: number;
}

/** Summen der Käufe und Verkäufe (in Euro) */
export function transferTotals(list: HoTransfer[], teamId: number, rate: number): TransferTotals {
  const t: TransferTotals = { bought: 0, sold: 0, spent: 0, earned: 0 };
  for (const x of list) {
    if (x.buyerId === teamId) {
      t.bought++;
      t.spent += x.price / rate;
    } else if (x.sellerId === teamId) {
      t.sold++;
      t.earned += x.price / rate;
    }
  }
  return t;
}
