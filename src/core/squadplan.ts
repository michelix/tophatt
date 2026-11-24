// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Kaderplanung für den ganzen Kader: Jeder Spieler bekommt einen Mannschaftsteil und eine Rolle
// (Stammspieler, Ersatz, Talent, überzählig). Daraus folgen Bedarf je Mannschaftsteil, Lücken,
// Überhang samt Gehalt und konkrete Schritte. Stärke wie in squad.ts: HO-Positionsstärke heute
// und mit den projizierten Fertigkeiten (Training und Altersabbau) in zwei Saisons.

import { type FieldPosition, type Player, Role } from "./model";
import { type LineupSector, lineupSector, playerPositionRating } from "./rating";
import { DEV_SKILLS, type ProjectionPoint } from "./development";
import { GROUPS, GROUP_DE } from "./squad";
import { loc } from "./locale";

export type SquadRole = "starter" | "backup" | "talent" | "surplus";

export const ROLE_DE: Record<SquadRole, string> = {
  starter: "Stammspieler",
  backup: "Ersatz",
  talent: "Talent",
  surplus: "Überzählig",
};

/** Stellvertretende Position je Mannschaftsteil (wie squad.ts) */
const GROUP_ROLE: Record<LineupSector, number> = {
  goal: Role.keeper,
  centralDefence: Role.middleCentralDefender,
  back: Role.leftBack,
  innerMidfield: Role.centralInnerMidfield,
  wing: Role.leftWinger,
  forward: Role.centralForward,
};

/** Wochen bis „in zwei Saisons“ */
export const PLAN_WEEKS = 32;
/** Ein Talent ist höchstens so alt … */
export const TALENT_MAX_AGE = 21;
/** … und erreicht in zwei Saisons mindestens diesen Anteil an den Stammspielern seines Mannschaftsteils */
export const TALENT_SHARE = 0.85;
/** Ersatz zählt ab diesem Anteil am schwächsten Stammspieler als brauchbar (gleichwertig ab 85 %) */
export const USABLE_BACKUP = 0.6;

export interface PlannedPlayer {
  player: Player;
  group: LineupSector;
  role: SquadRole;
  /** Positionsstärke heute und in zwei Saisons (im zugeordneten Mannschaftsteil) */
  now: number;
  later: number;
  ageLater: number;
  /** Anteil am Durchschnitt der Stammspieler des Mannschaftsteils (heute) */
  share: number;
  reason: string;
}

export interface GroupNeed {
  group: LineupSector;
  name: string;
  places: number;
  /** Soll: Plätze plus je Platz ein Ersatz (Torwart: 2) */
  target: number;
  starters: PlannedPlayer[];
  backups: PlannedPlayer[];
  talents: PlannedPlayer[];
  surplus: PlannedPlayer[];
  /** fehlende brauchbare Ersatzleute (> 0 = Lücke) */
  missing: number;
  /** Durchschnitt der Stammspieler heute und in zwei Saisons */
  strengthNow: number;
  strengthLater: number;
  status: "gap" | "thin" | "ok" | "crowded";
  note: string;
}

export interface SquadAction {
  kind: "sell" | "fill" | "successor" | "develop";
  /** Mannschaftsteil (bei Lücken und Nachfolgern) */
  group?: LineupSector;
  title: string;
  text: string;
  players: number[];
}

export interface SquadPlan {
  players: PlannedPlayer[];
  groups: GroupNeed[];
  actions: SquadAction[];
  size: number;
  target: number;
  surplusSalary: number;
  salary: number;
  averageAge: number;
}

const valueIn = (p: Player, g: LineupSector) => playerPositionRating(p, GROUP_ROLE[g]);

function atPoint(p: Player, pt: ProjectionPoint): Player {
  const q = { ...p, age: pt.age, ageDays: pt.ageDays };
  for (const sk of DEV_SKILLS) q[sk] = pt.values[sk];
  return q;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Plan für den ganzen Kader auf Grundlage einer Aufstellung.
 *
 * 1. Stammspieler sind die Spieler der Aufstellung, in ihrem Mannschaftsteil.
 * 2. Alle anderen kommen in den Mannschaftsteil, in dem sie relativ zu den Stammspielern dort am stärksten sind,
 *    heute oder in zwei Saisons (das Bessere zählt, damit Talente bei ihrer künftigen Position stehen).
 * 3. Je Mannschaftsteil werden die Ersatzplätze (ein Ersatz je Platz) mit den Stärksten von heute besetzt, sofern
 *    sie einsetzbar sind. Junge Spieler, die in zwei Saisons fast Stammspieler-Niveau erreichen, sind Talente.
 *    Der Rest ist überzählig: kein Platz in Elf, Bank oder Zukunft, kostet aber Gehalt.
 */
export function planWholeSquad(players: Player[], positions: FieldPosition[], projection: (p: Player) => ProjectionPoint[]): SquadPlan {
  const byId = new Map(players.map((p) => [p.id, p]));
  const places = new Map<LineupSector, number>(GROUPS.map((g) => [g, 0]));
  const starterGroup = new Map<number, LineupSector>();
  for (const pos of positions) {
    if (!byId.has(pos.playerId) || starterGroup.has(pos.playerId)) continue;
    const g = lineupSector(pos.role);
    starterGroup.set(pos.playerId, g);
    places.set(g, places.get(g)! + 1);
  }
  const later = new Map<number, Player>();
  for (const p of players) {
    const pts = projection(p);
    later.set(p.id, atPoint(p, pts[Math.min(PLAN_WEEKS, pts.length - 1)]));
  }
  const nowV = (p: Player, g: LineupSector) => valueIn(p, g);
  const laterV = (p: Player, g: LineupSector) => valueIn(later.get(p.id)!, g);

  // Bezug je Mannschaftsteil: Durchschnitt der Stammspieler (ohne Stammspieler: die zwei Besten des Kaders)
  const ref = new Map<LineupSector, number>();
  for (const g of GROUPS) {
    const st = players.filter((p) => starterGroup.get(p.id) === g).map((p) => nowV(p, g));
    const top = st.length ? st : players.map((p) => nowV(p, g)).sort((a, b) => b - a).slice(0, 2);
    ref.set(g, Math.max(1e-6, avg(top)));
  }
  const rel = (p: Player, g: LineupSector) => Math.max(nowV(p, g), laterV(p, g)) / ref.get(g)!;
  const used = GROUPS.filter((g) => places.get(g)! > 0);
  const target = (g: LineupSector) => (g === "goal" ? 2 : 2 * places.get(g)!);
  // Torhüter bleiben im Tor, Feldspieler im Feld
  const isKeeper = (p: Player) => p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.passing, p.scoring);
  const allowed = (p: Player, g: LineupSector) => (g === "goal") === isKeeper(p) || !used.includes(isKeeper(p) ? "goal" : g);
  const weakestNow = new Map(used.map((g) => [g, Math.max(1e-6, Math.min(...players.filter((p) => starterGroup.get(p.id) === g).map((p) => nowV(p, g))))]));

  // Ersatzplätze: je Mannschaftsteil (Soll − Plätze), vergeben nach Anteil am schwächsten Stammspieler, jeder nur einmal.
  // So landet ein Stürmer, der auch im Mittelfeld aushelfen könnte, dort, wo er als Ersatz am meisten taugt.
  const backupOf = new Map<number, LineupSector>();
  const free = new Map(used.map((g) => [g, target(g) - places.get(g)!]));
  const pairs = players
    .filter((p) => !starterGroup.has(p.id) && p.injury <= 2)
    .flatMap((p) => used.filter((g) => allowed(p, g)).map((g) => ({ p, g, share: nowV(p, g) / weakestNow.get(g)! })))
    .filter((x) => x.share >= USABLE_BACKUP)
    .sort((a, b) => b.share - a.share);
  for (const { p, g } of pairs) {
    if (backupOf.has(p.id) || free.get(g)! <= 0) continue;
    backupOf.set(p.id, g);
    free.set(g, free.get(g)! - 1);
  }
  const groupOf = (p: Player) =>
    starterGroup.get(p.id) ?? backupOf.get(p.id) ?? used.filter((g) => allowed(p, g)).reduce((a, b) => (rel(p, b) > rel(p, a) ? b : a), used.find((g) => allowed(p, g)) ?? used[0]);
  const planned: PlannedPlayer[] = [];
  const groups: GroupNeed[] = [];
  for (const g of used) {
    const members = players.filter((p) => groupOf(p) === g);
    const starters = members.filter((p) => starterGroup.get(p.id) === g);
    const weakest = Math.max(1e-6, Math.min(...starters.map((p) => nowV(p, g))));
    const startersLater = avg(starters.map((p) => laterV(p, g)));
    const make = (p: Player, role: SquadRole, reason: string): PlannedPlayer => ({
      player: p,
      group: g,
      role,
      now: nowV(p, g),
      later: laterV(p, g),
      ageLater: later.get(p.id)!.age,
      share: nowV(p, g) / ref.get(g)!,
      reason,
    });
    const st = starters.map((p) => {
      const drop = (nowV(p, g) - laterV(p, g)) / nowV(p, g);
      return make(p, "starter", drop >= 0.1 ? `Spielt, baut aber ab: ${pct(drop)} schwächer in zwei Saisons.` : "Spielt in deiner Aufstellung.");
    });
    const rest = members.filter((p) => !starterGroup.has(p.id)).sort((a, b) => nowV(b, g) - nowV(a, g));
    const slots = target(g) - starters.length;
    const backups: PlannedPlayer[] = [];
    const talents: PlannedPlayer[] = [];
    const surplus: PlannedPlayer[] = [];
    for (const p of rest) {
      const share = nowV(p, g) / weakest;
      const isTalent = p.age <= TALENT_MAX_AGE && startersLater > 0 && laterV(p, g) >= TALENT_SHARE * startersLater && laterV(p, g) > nowV(p, g);
      // Ersatz laut Verteilung oben (kurz Verletzte bis 2 Wochen zählen mit)
      if (backupOf.get(p.id) === g) {
        backups.push(make(p, "backup", `${pct(share)} des schwächsten Stammspielers.`));
      } else if (isTalent) {
        talents.push(make(p, "talent", `${p.age} Jahre, in zwei Saisons ${pct(laterV(p, g) / startersLater)} der Stammspieler.`));
      } else {
        const why =
          backups.length >= slots
            ? `${g === "goal" ? "Torwart" : GROUP_DE[g]}: ${starters.length + backups.length} reichen für ${places.get(g)} ${places.get(g) === 1 ? "Platz" : "Plätze"}`
            : `zu schwach als Ersatz (${pct(share)} des schwächsten Stammspielers)`;
        surplus.push(make(p, "surplus", `${why}; ${p.age} Jahre, ${Math.round(p.salary).toLocaleString(loc())} €/Woche.`));
      }
    }
    const usable = backups.length;
    const missing = Math.max(0, target(g) - starters.length - usable);
    const strengthNow = avg(st.map((x) => x.now));
    const strengthLater = avg(st.map((x) => x.later));
    const count = starters.length + backups.length + talents.length + surplus.length;
    let status: GroupNeed["status"] = "ok";
    let note = `${count} Spieler für ${places.get(g)} ${places.get(g) === 1 ? "Platz" : "Plätze"}, Soll ${target(g)}.`;
    if (missing > 0 && backups.length === 0) {
      status = "gap";
      note += ` Kein brauchbarer Ersatz.`;
    } else if (missing > 0) {
      status = "thin";
      note += ` ${missing} Ersatz fehlt.`;
    } else if (surplus.length >= 2) {
      status = "crowded";
      note += ` ${surplus.length} zu viel.`;
    }
    groups.push({ group: g, name: GROUP_DE[g], places: places.get(g)!, target: target(g), starters: st, backups, talents, surplus, missing, strengthNow, strengthLater, status, note });
    planned.push(...st, ...backups, ...talents, ...surplus);
  }

  // Schritte: Lücken zuerst, dann Nachfolger, Verkauf, Talente
  const actions: SquadAction[] = [];
  for (const n of groups.filter((x) => x.missing > 0)) {
    // bester Aushelfer aus anderen Mannschaftsteilen (überzählig oder Ersatz anderswo, ohne dort eine Lücke zu reißen)
    const donors = planned
      .filter((x) => x.group !== n.group && (x.role === "surplus" || x.role === "talent"))
      .map((x) => ({ x, share: nowV(x.player, n.group) / Math.max(1e-6, Math.min(...n.starters.map((s) => s.now))) }))
      .sort((a, b) => b.share - a.share);
    const d = donors[0];
    const help = d && d.share >= USABLE_BACKUP ? ` ${d.x.player.name} (${d.x.player.age}) käme dort auf ${pct(d.share)} des schwächsten Stammspielers und könnte aushelfen.` : "";
    actions.push({
      kind: "fill",
      title: `${n.name}: ${n.missing} Spieler ${n.missing === 1 ? "fehlt" : "fehlen"}`,
      text: `Für ${n.places} ${n.places === 1 ? "Platz" : "Plätze"} gibt es ${n.backups.length ? `nur ${n.backups.length} brauchbaren Ersatz` : "keinen brauchbaren Ersatz"}.${help} Sonst kaufen (Suchprofil unter Transfers).`,
      players: d && d.share >= USABLE_BACKUP ? [d.x.player.id] : [],
      group: n.group,
    });
  }
  for (const n of groups) {
    const fading = n.starters.filter((s) => s.now > 0 && (s.now - s.later) / s.now >= 0.1);
    if (!fading.length) continue;
    const heirs = [...n.talents, ...n.backups].filter((x) => x.later >= Math.min(...fading.map((f) => f.later))).sort((a, b) => b.later - a.later);
    actions.push({
      kind: "successor",
      title: `${n.name}: Nachfolger für ${fading.map((f) => f.player.name.split(" ").slice(-1)[0]).join(", ")}`,
      text: `${fading.map((f) => `${f.player.name} (${f.player.age})`).join(", ")} ${fading.length === 1 ? "verliert" : "verlieren"} bis in zwei Saisons mindestens 10 % Stärke. ${heirs.length ? `Im Kader rückt ${heirs[0].player.name} (${heirs[0].player.age}) nach.` : "Im Kader ist kein Nachfolger in Sicht."}`,
      players: [...fading.map((f) => f.player.id), ...(heirs[0] ? [heirs[0].player.id] : [])],
    });
  }
  const surplus = planned.filter((x) => x.role === "surplus" && x.player.injury <= 0);
  const surplusSalary = surplus.reduce((s, x) => s + x.player.salary, 0);
  if (surplus.length) {
    const list = [...surplus].sort((a, b) => b.player.salary - a.player.salary);
    actions.push({
      kind: "sell",
      title: `${surplus.length} Spieler verkaufen oder entlassen`,
      text: `Sie haben weder in Elf und Bank noch als Talent einen Platz. Zusammen ${Math.round(surplusSalary).toLocaleString(loc())} €/Woche Gehalt. Teuerste zuerst: ${list
        .slice(0, 3)
        .map((x) => `${x.player.name} (${Math.round(x.player.salary).toLocaleString(loc())} €)`)
        .join(", ")}.`,
      players: list.map((x) => x.player.id),
    });
  }
  const talents = planned.filter((x) => x.role === "talent");
  if (talents.length)
    actions.push({
      kind: "develop",
      title: `${talents.length} ${talents.length === 1 ? "Talent" : "Talente"} halten und trainieren`,
      text: `${talents.map((x) => `${x.player.name} (${x.player.age}, ${GROUP_DE[x.group]})`).join(", ")}. Sie sind heute noch keine Ersatzleute, wachsen aber in zwei Saisons fast auf Stammspieler-Niveau.`,
      players: talents.map((x) => x.player.id),
    });

  const salary = players.reduce((s, p) => s + p.salary, 0);
  return {
    players: planned,
    groups,
    actions,
    size: players.length,
    target: groups.reduce((s, g) => s + g.target, 0),
    surplusSalary,
    salary,
    averageAge: avg(players.map((p) => p.age + p.ageDays / 112)),
  };
}
