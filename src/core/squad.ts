// Kaderplanung je Position: Wer trägt die Mannschaftsteile heute, in einer und in zwei Saisons?
// Grundlage sind die projizierten Fertigkeiten (Training und Altersabbau aus development.ts) und die
// Positionsstärke aus HO (playerPositionRating).

import { type Lineup, type Player, Role } from "./model";
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

export interface HorizonPlan {
  label: string;
  weeks: number;
  starters: PlanEntry[];
  /** Durchschnitt der Stammspieler */
  average: number;
  backup: PlanEntry | null;
}

export interface GroupPlan {
  group: LineupSector;
  name: string;
  /** Stammplätze laut aktueller Formation */
  needed: number;
  horizons: HorizonPlan[];
  severity: "critical" | "warning" | "good";
  note: string;
}

/** Spieler mit den Fertigkeiten eines Projektionspunkts */
function atPoint(p: Player, pt: ProjectionPoint): Player {
  const q = { ...p, age: pt.age, ageDays: pt.ageDays };
  for (const sk of DEV_SKILLS) q[sk] = pt.values[sk];
  return q;
}

/**
 * @param projection Projektion je Spieler über mindestens 32 Wochen (Woche 0 = heute)
 */
export function planSquad(players: Player[], lineup: Lineup, projection: (p: Player) => ProjectionPoint[]): GroupPlan[] {
  const needed = new Map<LineupSector, number>(GROUPS.map((g) => [g, 0]));
  for (const pos of lineup.positions) needed.set(lineupSector(pos.role), needed.get(lineupSector(pos.role))! + 1);
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

  const horizonPlans = values.map(({ h, m, age }) => {
    // Gierige Verteilung: das relativ stärkste Paar (Spieler, Gruppe) zuerst, jeder Spieler nur einmal Stammspieler
    const pairs = players.flatMap((p) => GROUPS.filter((g) => needed.get(g)! > 0).map((g) => ({ p, g, v: m.get(p.id)![g], rel: m.get(p.id)![g] / ref.get(g)! })));
    pairs.sort((a, b) => b.rel - a.rel);
    const used = new Set<number>();
    const starters = new Map<LineupSector, PlanEntry[]>(GROUPS.map((g) => [g, []]));
    for (const { p, g, v } of pairs) {
      if (used.has(p.id) || starters.get(g)!.length >= needed.get(g)!) continue;
      used.add(p.id);
      starters.get(g)!.push({ id: p.id, name: p.name, age: age(p), value: v });
    }
    const out = new Map<LineupSector, HorizonPlan>();
    for (const g of GROUPS) {
      const st = starters.get(g)!.sort((a, b) => b.value - a.value);
      const backupP = players.filter((p) => !used.has(p.id)).sort((a, b) => m.get(b.id)![g] - m.get(a.id)![g])[0];
      out.set(g, {
        label: h.label,
        weeks: h.weeks,
        starters: st,
        average: st.length ? st.reduce((s, e) => s + e.value, 0) / st.length : 0,
        backup: backupP ? { id: backupP.id, name: backupP.name, age: age(backupP), value: m.get(backupP.id)![g] } : null,
      });
    }
    return out;
  });

  return GROUPS.filter((g) => needed.get(g)! > 0).map((g) => {
    const hs = horizonPlans.map((x) => x.get(g)!);
    const [now, one, two] = hs;
    const drop1 = now.average ? (now.average - one.average) / now.average : 0;
    const drop2 = now.average ? (now.average - two.average) / now.average : 0;
    const weakest = now.starters[now.starters.length - 1];
    const thin = !now.backup || (weakest && now.backup.value < weakest.value * 0.7);
    const leaving = now.starters.filter((e) => !two.starters.some((x) => x.id === e.id));
    let severity: GroupPlan["severity"] = "good";
    const notes: string[] = [];
    if (drop1 >= 0.12 || drop2 >= 0.2) {
      severity = "critical";
      notes.push(`Stärke sinkt um ${Math.round(drop2 * 100)} % in zwei Saisons. Nachfolger jetzt aufbauen oder kaufen.`);
    } else if (drop2 >= 0.08) {
      severity = "warning";
      notes.push(`Stärke sinkt um ${Math.round(drop2 * 100)} % in zwei Saisons.`);
    } else if (two.average > now.average * 1.05) {
      notes.push(`Wird stärker (+${Math.round((two.average / now.average - 1) * 100)} % in zwei Saisons).`);
    }
    if (leaving.length && drop2 >= 0.08) notes.push(`Fällt aus der Stammelf: ${leaving.map((e) => e.name).join(", ")}.`);
    if (thin) {
      if (severity === "good") severity = "warning";
      notes.push(now.backup ? `Keine gleichwertige Reserve (bester Ersatz ${now.backup.name}).` : "Keine Reserve im Kader.");
    }
    if (!notes.length) notes.push("Gut besetzt, auch in zwei Saisons.");
    return { group: g, name: GROUP_DE[g], needed: needed.get(g)!, horizons: hs, severity, note: notes.join(" ") };
  });
}
