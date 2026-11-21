// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Elfmeterschützen, Auswechslungen/Anweisungen und Reserve-Reihe der Ersatzbank,
// so wie HO sie im [lineup]-Abschnitt einer HRF-Datei liest (Lineup(Properties), HRFStringBuilder).

import { type BenchSlot, type Lineup, type MatchOrder, type OrderKind, type Player, Role, Specialty } from "./model";
import { playerPositionRating, skillRating, strength } from "./rating";

export const ORDER_KIND_DE: Record<OrderKind, string> = {
  sub: "Auswechslung",
  behaviour: "Verhalten",
  swap: "Positionstausch",
  marking: "Manndeckung",
};

/** HT/HO-Auftragsart im HRF: Auswechslung und Verhalten = 1, Positionstausch = 3, Manndeckung = 4 */
export const ORDER_TYPE_ID: Record<OrderKind, number> = { sub: 1, behaviour: 1, swap: 3, marking: 4 };

/** HO GoalDiffCriteria */
export const STANDING_DE: [number, string][] = [
  [-1, "egal"],
  [0, "Unentschieden"],
  [1, "in Führung"],
  [2, "im Rückstand"],
  [3, "mehr als 1 Tor vorne"],
  [4, "mehr als 1 Tor hinten"],
  [5, "nicht im Rückstand"],
  [6, "nicht in Führung"],
  [7, "mehr als 2 Tore vorne"],
  [8, "mehr als 2 Tore hinten"],
  [9, "nicht unentschieden"],
  [10, "höchstens 1 Tor vorne"],
  [11, "höchstens 1 Tor hinten"],
  [12, "höchstens 2 Tore vorne"],
  [13, "höchstens 2 Tore hinten"],
];

/** HO RedCardCriteria */
export const CARD_DE: [number, string][] = [
  [-1, "egal"],
  [1, "eigene Rote Karte"],
  [2, "Rote Karte beim Gegner"],
  [11, "eigener Innenverteidiger vom Platz"],
  [12, "eigener Mittelfeldspieler vom Platz"],
  [13, "eigener Stürmer vom Platz"],
  [14, "eigener Außenverteidiger vom Platz"],
  [15, "eigener Flügelspieler vom Platz"],
  [21, "gegn. Innenverteidiger vom Platz"],
  [22, "gegn. Mittelfeldspieler vom Platz"],
  [23, "gegn. Stürmer vom Platz"],
  [24, "gegn. Außenverteidiger vom Platz"],
  [25, "gegn. Flügelspieler vom Platz"],
];

export const BENCH_BACKUP_KEYS: Record<BenchSlot, string> = {
  keeper: "substgk2",
  centralDefender: "substcd2",
  wingBack: "substwb2",
  innerMidfield: "substim2",
  forward: "substfw2",
  winger: "substwi2",
  extra: "substxt2",
};

export function newOrder(kind: OrderKind, playerOut = 0, playerIn = 0): MatchOrder {
  const marking = kind === "marking";
  return {
    kind,
    playerOut,
    playerIn: kind === "behaviour" ? playerOut : playerIn,
    minute: marking ? -1 : 60,
    role: -1,
    behaviour: -1,
    card: -1,
    standing: -1,
  };
}

// --- Elfmeterschützen ------------------------------------------------------------------

/** HO RatingPredictionModel.calcPlayerPenaltyStrength */
export function penaltyStrength(p: Player): number {
  let v = skillRating(p.experience) * 1.5 + strength(p, "setPieces") * 0.7 + strength(p, "scoring") * 0.3;
  if (p.specialty === Specialty.Technical) v *= 1.1;
  return v;
}

/** Wie HO „Automatisch besetzen“: Startelf und Bank nach Elfmeterstärke, höchstens 11 */
export function autoPenaltyTakers(lineup: Pick<Lineup, "positions" | "bench">, byId: Map<number, Player>): number[] {
  const ids = [...lineup.positions.map((p) => p.playerId), ...Object.values(lineup.bench).filter((x): x is number => !!x)];
  return [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter((p): p is Player => !!p)
    .sort((a, b) => penaltyStrength(b) - penaltyStrength(a))
    .slice(0, 11)
    .map((p) => p.id);
}

// --- Reserve-Reihe der Bank ------------------------------------------------------------

/** HO Lineup.adjustBackupPlayers: Reserve muss selbst auf der Bank sitzen und darf nicht der Spieler des Platzes sein */
export function validBackups(bench: Lineup["bench"], backups: Lineup["backups"] = {}): Partial<Record<BenchSlot, number>> {
  const subs = new Set(Object.values(bench).filter(Boolean));
  const out: Partial<Record<BenchSlot, number>> = {};
  for (const [slot, id] of Object.entries(backups) as [BenchSlot, number][]) {
    if (id && subs.has(id) && bench[slot] !== id) out[slot] = id;
  }
  return out;
}

const BACKUP_ROLES: Record<BenchSlot, number[]> = {
  keeper: [Role.keeper],
  centralDefender: [Role.leftCentralDefender],
  wingBack: [Role.leftBack],
  innerMidfield: [Role.leftInnerMidfield],
  forward: [Role.centralForward],
  winger: [Role.leftWinger],
  extra: [Role.leftCentralDefender, Role.leftBack, Role.leftInnerMidfield, Role.leftWinger, Role.centralForward],
};

/** Stärke eines Spielers für einen Bankplatz (Joker: beste Feldposition) */
export const benchSlotValue = (p: Player, slot: BenchSlot) => Math.max(...BACKUP_ROLES[slot].map((r) => playerPositionRating(p, r)));

/**
 * Reserve je Bankplatz: eigene Wahl (Spieler-ID, 0 = keine) bleibt, sonst der stärkste andere Bankspieler
 * für die Position des Platzes. Plätze ohne Bankspieler bekommen keine Reserve.
 */
export function autoBackups(bench: Lineup["bench"], byId: Map<number, Player>, own: Partial<Record<BenchSlot, number>> = {}): Partial<Record<BenchSlot, number>> {
  const out: Partial<Record<BenchSlot, number>> = {};
  const valid = validBackups(bench, own);
  for (const slot of Object.keys(BACKUP_ROLES) as BenchSlot[]) {
    const id = bench[slot];
    if (!id) continue;
    if (slot in own) {
      if (valid[slot]) out[slot] = valid[slot];
      if (own[slot] === 0 || valid[slot]) continue;
    }
    let best = 0;
    let bestV = -1;
    for (const other of Object.values(bench)) {
      const p = other && other !== id ? byId.get(other) : undefined;
      if (!p) continue;
      const v = benchSlotValue(p, slot);
      if (v > bestV) {
        bestV = v;
        best = p.id;
      }
    }
    if (best) out[slot] = best;
  }
  return out;
}

// --- Anweisungen prüfen ----------------------------------------------------------------

/** HO SubstitutionOverview: höchstens 5 + Stufe Taktik-Assistent Anweisungen (Manndeckung zählt extra, höchstens 1) */
export const maxOrders = (tacticalAssistants: number) => 5 + Math.max(0, tacticalAssistants);

/** Probleme je Anweisung (Index → Texte), wie HO PlausibilityCheck plus Plausibles aus Spielersicht */
export function orderProblems(orders: MatchOrder[], lineup: Pick<Lineup, "positions" | "bench">, byId: Map<number, Player>, tacticalAssistants: number): string[][] {
  const field = new Set(lineup.positions.map((p) => p.playerId));
  const bench = new Set(Object.values(lineup.bench).filter(Boolean) as number[]);
  const inLineup = (id: number) => field.has(id) || bench.has(id);
  const name = (id: number) => byId.get(id)?.name ?? `Spieler ${id}`;
  const limit = maxOrders(tacticalAssistants);
  let counted = 0;
  let markings = 0;
  return orders.map((o) => {
    const out: string[] = [];
    if (o.kind === "marking") markings++;
    else counted++;
    if (!o.playerOut) out.push(o.kind === "sub" ? "Wer soll raus?" : "Spieler fehlt.");
    else if (!inLineup(o.playerOut)) out.push(`${name(o.playerOut)} steht nicht in der Aufstellung.`);
    switch (o.kind) {
      case "sub":
        if (!o.playerIn) out.push("Wer soll rein?");
        else if (!bench.has(o.playerIn)) out.push(`${name(o.playerIn)} sitzt nicht auf der Bank.`);
        if (o.playerOut && bench.has(o.playerOut) && !orders.some((x) => x !== o && x.kind === "sub" && x.playerIn === o.playerOut))
          out.push(`${name(o.playerOut)} sitzt auf der Bank und wird vorher nicht eingewechselt.`);
        break;
      case "behaviour":
        if (o.behaviour < 0 && o.role < 0) out.push("Neues Verhalten oder neue Position wählen.");
        break;
      case "swap":
        if (!o.playerIn) out.push("Tauschpartner fehlt.");
        else if (!inLineup(o.playerIn)) out.push(`${name(o.playerIn)} steht nicht in der Aufstellung.`);
        else if (o.playerIn === o.playerOut) out.push("Ein Spieler kann nicht mit sich selbst tauschen.");
        break;
      case "marking":
        if (!(o.playerIn > 0)) out.push("Gegenspieler fehlt (Spieler-ID des Gegners).");
        if (markings > 1) out.push("Nur eine Manndeckung erlaubt.");
        break;
    }
    if (o.kind !== "marking" && (o.minute < 0 || o.minute > 119)) out.push("Minute muss zwischen 0 und 119 liegen.");
    if (o.kind !== "marking" && counted > limit) out.push(`Zu viele Anweisungen: erlaubt sind ${limit}.`);
    return out;
  });
}

// --- HRF -------------------------------------------------------------------------------

/** Zeilen für den [lineup]-Abschnitt (Schlüssel wie HO HRFStringBuilder) */
export function orderKeys(lineup: Lineup): [string, number][] {
  const kv: [string, number][] = [];
  (lineup.orders ?? []).forEach((o, i) => {
    const p = `subst${i}`;
    const marking = o.kind === "marking";
    kv.push(
      [`${p}playerOrderID`, i],
      [`${p}playerIn`, o.kind === "behaviour" ? o.playerOut : o.playerIn],
      [`${p}playerOut`, o.playerOut],
      [`${p}orderType`, ORDER_TYPE_ID[o.kind]],
      [`${p}matchMinuteCriteria`, marking ? -1 : o.minute],
      [`${p}pos`, o.kind === "sub" || o.kind === "behaviour" ? o.role : -1],
      [`${p}behaviour`, marking || o.kind === "swap" ? -1 : o.behaviour],
      [`${p}card`, marking ? -1 : o.card],
      [`${p}standing`, marking ? -1 : o.standing],
    );
  });
  const pens = lineup.penaltyTakers ?? [];
  for (let i = 0; i < 11; i++) kv.push([`penalty${i}`, pens[i] ?? 0]);
  return kv;
}
