// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Kaderplanung je Position: Wer trägt die Mannschaftsteile heute, in einer und in zwei Saisons?
// Grundlage sind die projizierten Fertigkeiten (Training und Altersabbau aus development.ts) und die
// Positionsstärke aus HO (playerPositionRating).

import { type FieldPosition, type Player, Role } from "./model";
import { type LineupSector, lineupSector, playerPositionRating } from "./rating";
import { DEV_SKILLS, DEV_SKILL_DE, type DevSkill, type ProjectionPoint } from "./development";
import { staminaFactor } from "./rating";

export const GROUP_DE: Record<LineupSector, string> = {
  goal: "Torwart",
  centralDefence: "Innenverteidigung",
  back: "Außenverteidigung",
  innerMidfield: "Zentrales Mittelfeld",
  wing: "Flügel",
  forward: "Sturm",
};
export const GROUPS: LineupSector[] = ["goal", "centralDefence", "back", "innerMidfield", "wing", "forward"];

/** stellvertretende Position je Gruppe (normales Verhalten) */
const GROUP_ROLE: Record<LineupSector, number> = {
  goal: Role.keeper,
  centralDefence: Role.middleCentralDefender,
  back: Role.leftBack,
  innerMidfield: Role.centralInnerMidfield,
  wing: Role.leftWinger,
  forward: Role.centralForward,
};

export const GROUP_SHORT: Record<LineupSector, string> = { goal: "TW", centralDefence: "IV", back: "AV", innerMidfield: "ZM", wing: "FL", forward: "ST" };

/** Wichtigste Fertigkeiten je Gruppe laut Bewertungsformel (Hauptfertigkeit zuerst) */
export const GROUP_SKILLS: Record<LineupSector, DevSkill[]> = {
  goal: ["keeper", "defending"],
  centralDefence: ["defending", "playmaking"],
  back: ["defending", "winger"],
  innerMidfield: ["playmaking", "passing", "defending"],
  wing: ["winger", "playmaking"],
  forward: ["scoring", "passing", "winger"],
};
export { DEV_SKILL_DE };

/** Positionsstärke eines Spielers für eine Gruppe (stellvertretende Position, normales Verhalten) */
export const groupValue = (p: Player, g: LineupSector) => playerPositionRating(p, GROUP_ROLE[g]);

export interface Availability {
  /** Faktor 0..1: 0 = nicht einsetzbar */
  factor: number;
  status: "fit" | "angeschlagen" | "verletzt" | "gesperrt";
  label: string;
}

export function availability(p: Player): Availability {
  if (p.injury > 0) return { factor: 0, status: "verletzt", label: `verletzt, ${p.injury} ${p.injury === 1 ? "Woche" : "Wochen"}` };
  if (p.cards >= 3) return { factor: 0, status: "gesperrt", label: "gesperrt" };
  if (p.injury === 0) return { factor: 0.95, status: "angeschlagen", label: "angeschlagen" };
  return { factor: 1, status: "fit", label: "fit" };
}

/** Konditionsfaktor über 90 Minuten (1 = hält voll durch) */
export function staminaShare(stamina: number): number {
  let s = 0;
  for (let m = 0; m < 90; m += 5) s += staminaFactor(stamina, m, 0, 0);
  return Math.min(1, s / 18);
}

export interface GroupMember {
  player: Player;
  /** Positionsstärke ohne Kondition/Verletzung */
  value: number;
  /** Einsatzwert = Stärke × Kondition × Verfügbarkeit */
  score: number;
  /** relativ zum Besten der Gruppe, 0..1 */
  share: number;
  stamina: number;
  availability: Availability;
  /** ist das die beste Gruppe dieses Spielers? */
  home: boolean;
}

export interface SquadGroup {
  group: LineupSector;
  name: string;
  skills: DevSkill[];
  members: GroupMember[];
}

/**
 * Kader nach Mannschaftsteilen: jeder Spieler erscheint in seiner besten Gruppe und dort, wo er mindestens
 * 85 % seiner relativen Bestleistung und 70 % des Gruppenbesten erreicht (Allrounder tauchen mehrfach auf).
 */
export function squadGroups(players: Player[]): SquadGroup[] {
  const raw = new Map(players.map((p) => [p.id, Object.fromEntries(GROUPS.map((g) => [g, groupValue(p, g)])) as Record<LineupSector, number>]));
  const max = Object.fromEntries(GROUPS.map((g) => [g, Math.max(1e-6, ...players.map((p) => raw.get(p.id)![g]))])) as Record<LineupSector, number>;
  const rel = (p: Player, g: LineupSector) => raw.get(p.id)![g] / max[g];
  const best = new Map(players.map((p) => [p.id, GROUPS.reduce((a, b) => (rel(p, b) > rel(p, a) ? b : a))]));
  return GROUPS.map((g) => {
    const members = players
      .filter((p) => best.get(p.id) === g || (rel(p, g) >= 0.85 * rel(p, best.get(p.id)!) && rel(p, g) >= 0.7))
      .map((p) => {
        const av = availability(p);
        const st = staminaShare(p.stamina);
        const value = raw.get(p.id)![g];
        return { player: p, value, score: value * st * av.factor, share: 0, stamina: st, availability: av, home: best.get(p.id) === g };
      })
      .sort((a, b) => b.score - a.score || b.value - a.value);
    const top = Math.max(1e-6, ...members.map((m) => m.value));
    for (const m of members) m.share = m.score / top;
    return { group: g, name: GROUP_DE[g], skills: GROUP_SKILLS[g], members };
  });
}

/** Relative Eignung je Gruppe (1 = bester Spieler des Kaders dort) und beste Gruppe je Spieler */
export function fitTable(players: Player[]) {
  const max = Object.fromEntries(GROUPS.map((g) => [g, Math.max(1e-6, ...players.map((p) => groupValue(p, g)))])) as Record<LineupSector, number>;
  const rel = (p: Player, g: LineupSector) => groupValue(p, g) / max[g];
  const home = (p: Player) => GROUPS.reduce((a, b) => (rel(p, b) > rel(p, a) ? b : a));
  return { rel, home };
}

export const HORIZONS = [
  { label: "Jetzt", weeks: 0 },
  { label: "In 1 Saison", weeks: 16 },
  { label: "In 2 Saisons", weeks: 32 },
] as const;

export interface PlanEntry {
  id: number;
  name: string;
  age: number;
  value: number;
}

export interface BackupEntry extends PlanEntry {
  /** Stärke relativ zum schwächsten Stammspieler der Gruppe (1 = gleich stark) */
  share: number;
}

export interface HorizonPlan {
  label: string;
  weeks: number;
  starters: PlanEntry[];
  /** Durchschnitt der Stammspieler */
  average: number;
  backup: BackupEntry | null;
}

export interface GroupPlan {
  group: LineupSector;
  name: string;
  /** Stammplätze laut Aufstellung */
  needed: number;
  horizons: HorizonPlan[];
  severity: "critical" | "warning" | "good";
  note: string;
}

/** Ein Ersatz gilt als gleichwertig, wenn er mindestens so viel Positionsstärke hat (Anteil am schwächsten Stammspieler) */
export const BACKUP_SHARE = 0.85;
/** Ein Nachfolger verdrängt einen Stammspieler erst, wenn er relativ (zum Gruppenbesten heute) so viel stärker ist */
const SWAP_MARGIN = 0.02;
/** darunter fehlt praktisch eine Reserve */
export const BACKUP_SHARE_CRITICAL = 0.6;

/** Spieler mit den Fertigkeiten eines Projektionspunkts */
function atPoint(p: Player, pt: ProjectionPoint): Player {
  const q = { ...p, age: pt.age, ageDays: pt.ageDays };
  for (const sk of DEV_SKILLS) q[sk] = pt.values[sk];
  return q;
}

/**
 * Kaderplanung auf Grundlage einer Aufstellung.
 *
 * „Jetzt“ sind genau die Spieler dieser Aufstellung die Stammspieler. Später bleiben sie auf ihren Plätzen, bis ein
 * freier Spieler dort stärker ist als der schwächste von ihnen; dann übernimmt er als Nachfolger. So zeigt sich, wer
 * deine Plätze in einer und in zwei Saisons trägt, ohne dass eine andere Verteilung den Vergleich verfälscht.
 *
 * Ersatz: Jede Gruppe bekommt genau einen Ersatz, und jeder Spieler ist höchstens für eine Gruppe Ersatz (wie die
 * Bank bei Hattrick). Heute zählen nur einsetzbare Spieler. Gleichwertig ist ein Ersatz ab {@link BACKUP_SHARE} der
 * Positionsstärke des schwächsten Stammspielers.
 *
 * @param positions Aufstellung (11 Positionen); Spieler, die nicht im Kader sind, werden ignoriert
 * @param projection Projektion je Spieler über mindestens 32 Wochen (Woche 0 = heute)
 */
export function planSquad(players: Player[], lineup: { positions: FieldPosition[] }, projection: (p: Player) => ProjectionPoint[]): GroupPlan[] {
  const needed = new Map<LineupSector, number>(GROUPS.map((g) => [g, 0]));
  for (const pos of lineup.positions) needed.set(lineupSector(pos.role), needed.get(lineupSector(pos.role))! + 1);
  const byId = new Map(players.map((p) => [p.id, p]));
  const fixedNow = new Map<number, LineupSector>();
  for (const pos of lineup.positions) if (byId.has(pos.playerId) && !fixedNow.has(pos.playerId)) fixedNow.set(pos.playerId, lineupSector(pos.role));
  const proj = new Map(players.map((p) => [p.id, projection(p)]));

  // Positionsstärke je Spieler, Gruppe und Zeitpunkt
  const values = HORIZONS.map((h) => {
    const m = new Map<number, Record<LineupSector, number>>();
    for (const p of players) {
      const pts = proj.get(p.id)!;
      const q = atPoint(p, pts[Math.min(h.weeks, pts.length - 1)]);
      m.set(p.id, Object.fromEntries(GROUPS.map((g) => [g, playerPositionRating(q, GROUP_ROLE[g])])) as Record<LineupSector, number>);
    }
    return { h, m, age: (p: Player) => proj.get(p.id)![Math.min(h.weeks, proj.get(p.id)!.length - 1)].age };
  });

  // Bezugsgröße je Gruppe: bester Wert heute, damit Gruppen mit unterschiedlicher Skala vergleichbar werden
  const ref = new Map<LineupSector, number>();
  for (const g of GROUPS) ref.set(g, Math.max(1e-6, ...players.map((p) => values[0].m.get(p.id)![g])));

  const planAt = ({ h, m, age }: (typeof values)[number], hi: number, successors: boolean) => {
    const entry = (p: Player, g: LineupSector): PlanEntry => ({ id: p.id, name: p.name, age: age(p), value: m.get(p.id)![g] });
    const used = new Set<number>();
    const starters = new Map<LineupSector, PlanEntry[]>(GROUPS.map((g) => [g, []]));
    // Ausgangspunkt sind immer die Stammspieler der Aufstellung, mit ihren Werten zum jeweiligen Zeitpunkt
    for (const [id, g] of fixedNow) {
      if (starters.get(g)!.length >= needed.get(g)!) continue;
      used.add(id);
      starters.get(g)!.push(entry(byId.get(id)!, g));
    }
    // Gierige Verteilung der (übrigen) Plätze: das relativ stärkste Paar zuerst, jeder Spieler nur einmal Stammspieler
    const pairs = players.flatMap((p) => GROUPS.filter((g) => needed.get(g)! > 0).map((g) => ({ p, g, rel: m.get(p.id)![g] / ref.get(g)! })));
    pairs.sort((a, b) => b.rel - a.rel);
    for (const { p, g } of pairs) {
      if (used.has(p.id) || starters.get(g)!.length >= needed.get(g)!) continue;
      if (hi === 0 && availability(p).factor === 0) continue;
      used.add(p.id);
      starters.get(g)!.push(entry(p, g));
    }
    // Später: ein freier Spieler ersetzt den schwächsten Stammspieler einer Gruppe, sobald er dort stärker ist (Nachfolger)
    if (successors) {
      for (let guard = 0; guard < 40; guard++) {
        let best: { p: Player; g: LineupSector; out: PlanEntry; gain: number } | null = null;
        for (const p of players) {
          if (used.has(p.id)) continue;
          for (const g of GROUPS) {
            const st = starters.get(g)!;
            if (!st.length) continue;
            const out = st.reduce((a, b) => (b.value < a.value ? b : a));
            const gain = (m.get(p.id)![g] - out.value) / ref.get(g)!;
            if (gain > SWAP_MARGIN && (!best || gain > best.gain)) best = { p, g, out, gain };
          }
        }
        if (!best) break;
        const st = starters.get(best.g)!;
        st.splice(st.indexOf(best.out), 1, entry(best.p, best.g));
        used.delete(best.out.id);
        used.add(best.p.id);
      }
    }
    for (const st of starters.values()) st.sort((a, b) => b.value - a.value);

    // Ersatz: je Gruppe einer, jeder Spieler nur einmal; die engste Lücke (höchster Anteil) zuerst vergeben
    const weakest = (g: LineupSector) => Math.max(1e-6, Math.min(...starters.get(g)!.map((e) => e.value)));
    const backups = new Map<LineupSector, BackupEntry>();
    const candidates = players
      .filter((p) => !used.has(p.id) && (hi > 0 || availability(p).factor > 0))
      .flatMap((p) => GROUPS.filter((g) => needed.get(g)! > 0 && starters.get(g)!.length).map((g) => ({ p, g, share: m.get(p.id)![g] / weakest(g) })))
      .sort((a, b) => b.share - a.share);
    // zuerst die Gruppen, für die es nur wenige brauchbare Ersatzleute gibt, damit ein Allrounder nicht die einzige Reserve woanders wegnimmt
    const scarce = (g: LineupSector) => candidates.filter((c) => c.g === g && c.share >= BACKUP_SHARE).length;
    const order = GROUPS.filter((g) => needed.get(g)! > 0).sort((a, b) => scarce(a) - scarce(b));
    const taken = new Set<number>();
    for (const g of order) {
      const c = candidates.find((x) => x.g === g && !taken.has(x.p.id));
      if (!c) continue;
      taken.add(c.p.id);
      backups.set(g, { ...entry(c.p, g), share: c.share });
    }

    const out = new Map<LineupSector, HorizonPlan>();
    for (const g of GROUPS) {
      const st = starters.get(g)!;
      out.set(g, {
        label: h.label,
        weeks: h.weeks,
        starters: st,
        average: st.length ? st.reduce((s, e) => s + e.value, 0) / st.length : 0,
        backup: backups.get(g) ?? null,
      });
    }
    return out;
  };
  const horizonPlans = values.map((v, hi) => planAt(v, hi, hi > 0));
  // Bezug für den Trend: die stärkste Besetzung heute (mit Nachfolgern), damit eine nicht optimale eigene
  // Aufstellung keinen Zuwachs vortäuscht und nur Training und Alter den Trend bestimmen
  const bestNow = planAt(values[0], 0, true);

  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return GROUPS.filter((g) => needed.get(g)! > 0).map((g) => {
    const hs = horizonPlans.map((x) => x.get(g)!);
    const [now, one, two] = hs;
    const base = Math.max(now.average, bestNow.get(g)!.average);
    const drop1 = base ? (base - one.average) / base : 0;
    const drop2 = base ? (base - two.average) / base : 0;
    const leaving = now.starters.filter((e) => !two.starters.some((x) => x.id === e.id));
    let severity: GroupPlan["severity"] = "good";
    const raise = (s: GroupPlan["severity"]) => {
      if (s === "critical" || (s === "warning" && severity === "good")) severity = s;
    };
    const notes: string[] = [];
    if (drop1 >= 0.12 || drop2 >= 0.2) {
      raise("critical");
      notes.push(`Stärke sinkt um ${pct(drop2)} in zwei Saisons. Nachfolger jetzt aufbauen oder kaufen.`);
    } else if (drop2 >= 0.08) {
      raise("warning");
      notes.push(`Stärke sinkt um ${pct(drop2)} in zwei Saisons.`);
    } else if (two.average > base * 1.05) {
      notes.push(`Wird stärker (+${pct(two.average / base - 1)} in zwei Saisons).`);
    }
    if (leaving.length && drop2 >= 0.08) notes.push(`Fällt aus der Stammelf: ${leaving.map((e) => e.name).join(", ")}.`);

    // Reserve heute
    const b = now.backup;
    if (!b || b.share < BACKUP_SHARE_CRITICAL) {
      raise(needed.get(g)! >= 2 || g === "goal" ? "critical" : "warning");
      notes.push(b ? `Keine brauchbare Reserve: bester freier Ersatz ${b.name} erreicht nur ${pct(b.share)} des schwächsten Stammspielers.` : "Keine Reserve im Kader.");
    } else if (b.share < BACKUP_SHARE) {
      raise("warning");
      notes.push(`Reserve ${b.name} erreicht nur ${pct(b.share)} des schwächsten Stammspielers (gleichwertig ab ${pct(BACKUP_SHARE)}).`);
    } else {
      // Reserve heute gut, aber in einer Saison nicht mehr?
      const later = one.backup;
      if (!later || later.share < BACKUP_SHARE) {
        raise("warning");
        notes.push(`Reserve reicht heute (${b.name}), in einer Saison aber nicht mehr${later ? ` (${later.name} ${pct(later.share)})` : ""}.`);
      }
    }
    if (!notes.length) notes.push("Gut besetzt, mit gleichwertiger Reserve, auch in zwei Saisons.");
    return { group: g, name: GROUP_DE[g], needed: needed.get(g)!, horizons: hs, severity, note: notes.join(" ") };
  });
}

/**
 * Ausgewogene Zuordnung für die Kaderansicht. Stammspieler (aus der Aufstellung) stehen dort, wo sie spielen.
 * Danach bekommt jede Gruppe je Platz einen Ersatz. Maßstab ist die Stärke relativ zum Durchschnitt der
 * Stammspieler dieser Gruppe, also „wie nah kommt er an die, die dort spielen“, nicht relativ zum Einzelbesten
 * des Kaders; so drängt ein Ausreißer (z. B. Verteidiger mit Flügelspiel 10) nicht alle anderen aus der Gruppe.
 * Wer danach übrig ist, steht in seiner relativ stärksten Gruppe.
 */
export function balancedHome(players: Player[], starters: Map<number, LineupSector>): Map<number, LineupSector> {
  const needed = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<LineupSector, number>;
  for (const g of starters.values()) needed[g]++;
  const val = new Map(players.map((p) => [p.id, Object.fromEntries(GROUPS.map((g) => [g, groupValue(p, g)])) as Record<LineupSector, number>]));
  const ref = Object.fromEntries(
    GROUPS.map((g) => {
      const st = players.filter((p) => starters.get(p.id) === g).map((p) => val.get(p.id)![g]);
      const top = st.length ? st : players.map((p) => val.get(p.id)![g]).sort((a, b) => b - a).slice(0, 2);
      return [g, Math.max(1e-6, top.reduce((s, v) => s + v, 0) / top.length)];
    }),
  ) as Record<LineupSector, number>;
  const rel = (p: Player, g: LineupSector) => val.get(p.id)![g] / ref[g];
  const out = new Map<number, LineupSector>();
  const backups = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<LineupSector, number>;
  for (const p of players) if (starters.has(p.id)) out.set(p.id, starters.get(p.id)!);
  const pairs = players
    .filter((p) => !out.has(p.id))
    .flatMap((p) => GROUPS.filter((g) => needed[g] > 0).map((g) => ({ p, g, r: rel(p, g) })))
    .sort((a, b) => b.r - a.r);
  for (const { p, g, r } of pairs) {
    if (out.has(p.id) || backups[g] >= needed[g]) continue;
    // nur zuordnen, wenn die Gruppe für ihn nicht deutlich schlechter ist als seine beste
    if (r < 0.8 * Math.max(...GROUPS.map((x) => rel(p, x)))) continue;
    out.set(p.id, g);
    backups[g]++;
  }
  for (const p of players) if (!out.has(p.id)) out.set(p.id, GROUPS.reduce((a, b) => (rel(p, b) > rel(p, a) ? b : a)));
  return out;
}
