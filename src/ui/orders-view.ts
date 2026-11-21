// Seite „Anweisungen & Elfmeter“: Auswechslungen/Anweisungen, Elfmeterschützen und Reserve-Reihe der Bank,
// wie in HO (Reiter Aufstellung → Auswechslungen / Anweisungen, Elfmeterschützen). Logik in core/orders.ts.

import { type BenchSlot, type Lineup, type MatchOrder, type OrderKind, type Player, Role } from "../core/model";
import { CARD_DE, ORDER_KIND_DE, STANDING_DE, autoPenaltyTakers, maxOrders, newOrder, orderProblems, penaltyStrength, validBackups } from "../core/orders";

const STORE = "tophatt.orders";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const de = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const ROLE_NAME: [number, string][] = [
  [Role.keeper, "Torwart"],
  [Role.rightBack, "Rechter Verteidiger"],
  [Role.rightCentralDefender, "Innenverteidiger rechts"],
  [Role.middleCentralDefender, "Innenverteidiger Mitte"],
  [Role.leftCentralDefender, "Innenverteidiger links"],
  [Role.leftBack, "Linker Verteidiger"],
  [Role.rightWinger, "Rechter Flügel"],
  [Role.rightInnerMidfield, "Mittelfeld rechts"],
  [Role.centralInnerMidfield, "Mittelfeld Mitte"],
  [Role.leftInnerMidfield, "Mittelfeld links"],
  [Role.leftWinger, "Linker Flügel"],
  [Role.rightForward, "Sturm rechts"],
  [Role.centralForward, "Sturm Mitte"],
  [Role.leftForward, "Sturm links"],
];
const ROLE_SHORT: Record<number, string> = {
  100: "TW", 101: "RV", 102: "IV", 103: "IV", 104: "IV", 105: "LV", 106: "RF", 107: "ZM", 108: "ZM", 109: "ZM", 110: "LF", 111: "ST", 112: "ST", 113: "ST",
};
const BEHAVIOUR_NAME: [number, string][] = [
  [0, "normal"],
  [1, "offensiv"],
  [2, "defensiv"],
  [3, "zur Mitte"],
  [4, "nach außen"],
];
const BENCH_NAME: [BenchSlot, string][] = [
  ["keeper", "Torwart"],
  ["centralDefender", "Innenverteidiger"],
  ["wingBack", "Außenverteidiger"],
  ["innerMidfield", "Mittelfeld"],
  ["winger", "Flügel"],
  ["forward", "Sturm"],
  ["extra", "Joker"],
];

export interface OpponentPlayer {
  id: number;
  name: string;
  roles: number[];
  games: number;
}

export interface OrdersContext {
  /** Aufstellung von der Aufstellungsseite (ohne Anweisungen) */
  lineup: () => Lineup;
  byId: () => Map<number, Player>;
  tacticalAssistants: () => number;
  opponent: () => { name: string; players: OpponentPlayer[] } | null;
  /** nach jeder Änderung (z. B. Speichern-Leiste aktualisieren) */
  changed: () => void;
}

interface Stored {
  matchId: number;
  orders: MatchOrder[];
  /** null = automatisch wie HO */
  penalties: number[] | null;
  backups: Partial<Record<BenchSlot, number>>;
}

let store: Stored = { matchId: 0, orders: [], penalties: null, backups: {} };
let ctx: OrdersContext | null = null;
let root: HTMLElement | null = null;

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    /* ohne Speicher nur für diese Sitzung */
  }
}

/** Anweisungen gehören zu einem Spiel: für ein anderes Spiel wird neu begonnen */
export function loadOrders(matchId: number) {
  if (store.matchId === matchId && matchId) return;
  let s: Stored | null = null;
  try {
    s = JSON.parse(localStorage.getItem(STORE) ?? "null") as Stored | null;
  } catch {
    s = null;
  }
  store = s && s.matchId === matchId && Array.isArray(s.orders) ? { ...s, backups: s.backups ?? {} } : { matchId, orders: [], penalties: null, backups: {} };
}

const inLineup = (l: Pick<Lineup, "positions" | "bench">) => new Set([...l.positions.map((p) => p.playerId), ...(Object.values(l.bench).filter(Boolean) as number[])]);

function penaltiesFor(l: Lineup, byId: Map<number, Player>): number[] {
  if (!store.penalties) return autoPenaltyTakers(l, byId);
  const ids = inLineup(l);
  return store.penalties.filter((id) => ids.has(id)).slice(0, 11);
}

/** Aufstellung samt Reserve-Reihe, Elfmeterschützen und Anweisungen für den HRF-Export */
export function withOrders(l: Lineup, byId: Map<number, Player>): Lineup {
  return { ...l, backups: validBackups(l.bench, store.backups), penaltyTakers: penaltiesFor(l, byId), orders: store.orders.map((o) => ({ ...o })) };
}

/** Fehler in den Anweisungen, die das Speichern verhindern */
export function ordersBlocking(l: Lineup, byId: Map<number, Player>, tacticalAssistants: number): string[] {
  return orderProblems(store.orders, l, byId, tacticalAssistants).flatMap((ps, i) => ps.map((p) => `Anweisung ${i + 1} (${ORDER_KIND_DE[store.orders[i].kind]}): ${p}`));
}

export function ordersSummary(): string {
  const n = store.orders.length;
  return n ? `${n} ${n === 1 ? "Anweisung" : "Anweisungen"}` : "keine Anweisungen";
}

// --- Darstellung -----------------------------------------------------------------------

function opt(value: number, label: string, cur: number) {
  return `<option value="${value}"${value === cur ? " selected" : ""}>${esc(label)}</option>`;
}

function sel(i: number, field: keyof MatchOrder, label: string, options: string, wide = false) {
  return `<label${wide ? ' class="ord-wide"' : ""}>${label}<select data-oi="${i}" data-of="${field}">${options}</select></label>`;
}

function renderOrder(o: MatchOrder, i: number, n: number, l: Lineup, byId: Map<number, Player>, problems: string[]): string {
  const name = (id: number) => byId.get(id)?.name ?? "";
  const field = l.positions.map((p) => ({ id: p.playerId, label: `${name(p.playerId)} (${ROLE_SHORT[p.role]})` })).filter((x) => x.label);
  const bench = BENCH_NAME.map(([s, d]) => ({ id: l.bench[s] ?? 0, label: `${name(l.bench[s] ?? 0)} (Bank ${d})` })).filter((x) => x.id);
  const choose = (list: { id: number; label: string }[], cur: number, none = "– wählen –") =>
    opt(0, none, cur) + list.map((x) => opt(x.id, x.label, cur)).join("") + (cur && !list.some((x) => x.id === cur) ? opt(cur, `${name(cur) || `ID ${cur}`} (nicht aufgestellt)`, cur) : "");
  const group = (title: string, list: { id: number; label: string }[], cur: number) => (list.length ? `<optgroup label="${title}">${list.map((x) => opt(x.id, x.label, cur)).join("")}</optgroup>` : "");
  const both = (cur: number) => opt(0, "– wählen –", cur) + group("Startelf", field, cur) + group("Bank", bench, cur);
  const minute = `<label>Ab Minute<input type="number" min="0" max="119" value="${o.minute < 0 ? "" : o.minute}" data-oi="${i}" data-of="minute"></label>`;
  const role = sel(i, "role", "Neue Position", opt(-1, "bleibt", o.role) + ROLE_NAME.map(([r, t]) => opt(r, t, o.role)).join(""));
  const beh = sel(i, "behaviour", "Verhalten", opt(-1, "bleibt", o.behaviour) + BEHAVIOUR_NAME.map(([b, t]) => opt(b, t, o.behaviour)).join(""));
  const stand = sel(i, "standing", "Spielstand", STANDING_DE.map(([v, t]) => opt(v, t, o.standing)).join(""));
  const card = sel(i, "card", "Rote Karten", CARD_DE.map(([v, t]) => opt(v, t, o.card)).join(""));
  let controls = "";
  switch (o.kind) {
    case "sub":
      controls = sel(i, "playerOut", "Raus", both(o.playerOut), true) + sel(i, "playerIn", "Rein", choose(bench, o.playerIn), true) + minute + role + beh + stand + card;
      break;
    case "behaviour":
      controls = sel(i, "playerOut", "Spieler", both(o.playerOut), true) + minute + role + beh + stand + card;
      break;
    case "swap":
      controls = sel(i, "playerOut", "Spieler", both(o.playerOut), true) + sel(i, "playerIn", "Tauscht mit", both(o.playerIn), true) + minute + stand + card;
      break;
    case "marking": {
      const opp = ctx!.opponent();
      const list = (opp?.players ?? []).map((p) => ({ id: p.id, label: `${p.name} (${[...new Set(p.roles.map((r) => ROLE_SHORT[r] ?? ""))].filter(Boolean).join("/")}, ${p.games} ${p.games === 1 ? "Spiel" : "Spiele"})` }));
      const known = list.some((x) => x.id === o.playerIn);
      controls =
        sel(i, "playerOut", "Eigener Spieler", choose(field, o.playerOut), true) +
        (list.length ? sel(i, "playerIn", `Gegenspieler${opp ? ` (${esc(opp.name)})` : ""}`, opt(0, "– wählen –", known ? o.playerIn : 0) + list.map((x) => opt(x.id, x.label, o.playerIn)).join(""), true) : "") +
        `<label>Spieler-ID des Gegners<input type="number" min="0" value="${o.playerIn > 0 && !known ? o.playerIn : ""}" placeholder="${list.length ? "falls nicht in der Liste" : "z. B. 471234567"}" data-oi="${i}" data-of="playerIn"></label>`;
      break;
    }
  }
  const head = `${i + 1}. ${ORDER_KIND_DE[o.kind]}`;
  return `<div class="ord-row${problems.length ? " bad" : ""}">
    <div class="ord-top"><b>${head}</b><span class="sub">${esc(describe(o, byId))}</span><span class="spacer"></span>
      <button class="btn icon sm" data-omove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
      <button class="btn icon sm" data-omove="${i}" data-dir="1" ${i === n - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
      <button class="btn icon sm" data-odel="${i}" aria-label="Löschen">✕</button></div>
    <div class="controls">${controls}</div>
    ${problems.length ? `<ul class="ord-warn">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function describe(o: MatchOrder, byId: Map<number, Player>): string {
  const last = (id: number) => (byId.get(id)?.name ?? "?").split(" ").slice(-1)[0];
  const when = o.kind === "marking" ? "ganzes Spiel" : `ab Min. ${o.minute}`;
  const cond = [o.standing >= 0 ? STANDING_DE.find(([v]) => v === o.standing)?.[1] : "", o.card >= 0 ? CARD_DE.find(([v]) => v === o.card)?.[1] : ""].filter(Boolean).join(", ");
  const extra = [o.role >= 0 ? ROLE_NAME.find(([r]) => r === o.role)?.[1] : "", o.behaviour >= 0 ? BEHAVIOUR_NAME.find(([b]) => b === o.behaviour)?.[1] : ""].filter(Boolean).join(", ");
  let what = "";
  if (!o.playerOut) what = "";
  else if (o.kind === "sub") what = `${last(o.playerOut)} → ${o.playerIn ? last(o.playerIn) : "?"}`;
  else if (o.kind === "behaviour") what = last(o.playerOut);
  else if (o.kind === "swap") what = `${last(o.playerOut)} ⇄ ${o.playerIn ? last(o.playerIn) : "?"}`;
  else what = `${last(o.playerOut)} deckt ${o.playerIn > 0 ? (ctx?.opponent()?.players.find((p) => p.id === o.playerIn)?.name ?? `ID ${o.playerIn}`) : "?"}`;
  return [when, what, extra, cond && `wenn ${cond}`].filter(Boolean).join(" · ");
}

export function renderOrdersPage() {
  if (!root || !ctx) return;
  const l = ctx.lineup();
  const byId = ctx.byId();
  const ta = ctx.tacticalAssistants();
  const limit = maxOrders(ta);
  const counted = store.orders.filter((o) => o.kind !== "marking").length;
  const hasMarking = store.orders.some((o) => o.kind === "marking");
  const problems = orderProblems(store.orders, l, byId, ta);
  const full = counted >= limit;
  const addBtn = (k: OrderKind, label: string, off: boolean) => `<button class="btn" data-oadd="${k}" ${off ? "disabled" : ""}>+ ${label}</button>`;

  // Elfmeter
  const pens = penaltiesFor(l, byId);
  const ids = inLineup(l);
  const field = new Set(l.positions.map((p) => p.playerId));
  const cands = [...ids].map((id) => byId.get(id)).filter((p): p is Player => !!p && !pens.includes(p.id)).sort((a, b) => penaltyStrength(b) - penaltyStrength(a));
  const penRow = (id: number, i: number) => {
    const p = byId.get(id);
    if (!p) return "";
    return `<li><span class="pen-n">${i + 1}</span><span class="pen-name">${esc(p.name)}<span class="sub"> ${field.has(id) ? "Startelf" : "Bank"} · Erf. ${p.experience}, Std. ${p.setPieces}, Tor ${p.scoring}</span></span><span class="pen-v">${de(penaltyStrength(p))}</span>
      <button class="btn icon sm" data-pmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
      <button class="btn icon sm" data-pmove="${i}" data-dir="1" ${i === pens.length - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
      <button class="btn icon sm" data-pdel="${id}" aria-label="Entfernen">✕</button></li>`;
  };

  // Reserve-Reihe
  const benchIds = BENCH_NAME.map(([s]) => l.bench[s] ?? 0).filter(Boolean);
  const backups = validBackups(l.bench, store.backups);
  const lostBackups = Object.keys(store.backups).filter((k) => store.backups[k as BenchSlot] && !backups[k as BenchSlot]).length;
  const backupRow = ([slot, label]: [BenchSlot, string]) => {
    const own = l.bench[slot];
    const others = benchIds.filter((id) => id !== own);
    return `<label>${label}: <b class="bk-own">${own ? esc(byId.get(own)?.name ?? "") : "leer"}</b><select data-backup="${slot}" ${own ? "" : "disabled"}>${opt(0, "keine Reserve", backups[slot] ?? 0)}${others.map((id) => opt(id, byId.get(id)?.name ?? `ID ${id}`, backups[slot] ?? 0)).join("")}</select></label>`;
  };

  root.innerHTML = `
    <div class="ord-block">
      <h3>Auswechslungen &amp; Anweisungen <span class="sub">${counted} von ${limit} (5 + Taktik-Assistent Stufe ${ta})${hasMarking ? " · plus 1 Manndeckung" : ""}</span></h3>
      <div class="controls ord-add">${addBtn("sub", "Auswechslung", full)}${addBtn("behaviour", "Verhalten", full)}${addBtn("swap", "Positionstausch", full)}${addBtn("marking", "Manndeckung", hasMarking)}
        ${store.orders.length ? `<button class="btn" data-oclear>Alle löschen</button>` : ""}</div>
      ${store.orders.map((o, i) => renderOrder(o, i, store.orders.length, l, byId, problems[i])).join("") || `<p class="sub">Noch keine Anweisungen. Ohne Anweisungen wechselt Hattrick nur bei Verletzungen aus.</p>`}
      <p class="sub">Bedingungen wie in Hattrick: Die Anweisung gilt ab der Minute, sobald Spielstand und Rote Karten passen. Hattrick führt die Anweisungen in dieser Reihenfolge aus.</p>
    </div>
    <div class="ord-block">
      <h3>Elfmeterschützen <span class="sub">${store.penalties ? "von dir festgelegt" : "automatisch wie HO"} · ${pens.length} von 11</span></h3>
      <div class="controls"><button class="btn" data-pauto>Automatisch besetzen</button><button class="btn" data-pclear>Leeren</button></div>
      ${pens.length ? `<ol class="pen-list">${pens.map(penRow).join("")}</ol>` : `<p class="sub">Keine Schützen festgelegt. Dann wählt Hattrick selbst.</p>`}
      ${cands.length && pens.length < 11 ? `<div class="pen-add"><span class="sub">Hinzufügen:</span> ${cands.map((p) => `<button class="chipbtn" data-padd="${p.id}">${esc(p.name.split(" ").slice(-1)[0])} <span class="sub">${de(penaltyStrength(p))}</span></button>`).join("")}</div>` : ""}
      <p class="sub">Stärke wie HO: 1,5 × Erfahrung + 0,7 × Standards + 0,3 × Torschuss (mit Form und Treue), Ballzauberer +10 %. Die Liste gilt fürs Elfmeterschießen (Pokal und Entscheidungsspiele nach Verlängerung).</p>
    </div>
    <div class="ord-block">
      <h3>Reserve der Ersatzbank <span class="sub">die zweite Reihe in HO</span></h3>
      <p class="sub">Für jeden Bankplatz kannst du eine Reserve bestimmen. Wird für diese Position ein Ersatz gebraucht (Verletzung) und der Spieler des Platzes ist schon im Spiel, kommt die Reserve. Die Reserve muss selbst auf einem anderen Bankplatz sitzen, sie bringt also keinen zusätzlichen Spieler.</p>
      <div class="controls bk-grid">${BENCH_NAME.map(backupRow).join("")}</div>
      ${lostBackups ? `<p class="sub">${lostBackups} gespeicherte Reserve${lostBackups === 1 ? " passt" : "n passen"} nicht mehr zur Bank und ${lostBackups === 1 ? "wird" : "werden"} nicht gespeichert.</p>` : ""}
    </div>`;
}

function changed() {
  save();
  renderOrdersPage();
  ctx?.changed();
}

export function initOrdersPage(el: HTMLElement, c: OrdersContext) {
  root = el;
  ctx = c;
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!b || !ctx) return;
    const d = b.dataset;
    const l = ctx.lineup();
    const byId = ctx.byId();
    if (d.oadd) store.orders.push(newOrder(d.oadd as OrderKind));
    else if (d.odel !== undefined) store.orders.splice(Number(d.odel), 1);
    else if (d.omove !== undefined) move(store.orders, Number(d.omove), Number(d.dir));
    else if (d.oclear !== undefined) store.orders = [];
    else if (d.pauto !== undefined) store.penalties = autoPenaltyTakers(l, byId);
    else if (d.pclear !== undefined) store.penalties = [];
    else if (d.padd) store.penalties = [...penaltiesFor(l, byId), Number(d.padd)].slice(0, 11);
    else if (d.pdel) store.penalties = penaltiesFor(l, byId).filter((id) => id !== Number(d.pdel));
    else if (d.pmove !== undefined) {
      const list = penaltiesFor(l, byId);
      move(list, Number(d.pmove), Number(d.dir));
      store.penalties = list;
    } else return;
    changed();
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.backup) {
      store.backups = { ...store.backups, [t.dataset.backup]: Number(t.value) };
      return changed();
    }
    if (t.dataset.oi === undefined) return;
    const o = store.orders[Number(t.dataset.oi)];
    const f = t.dataset.of as keyof MatchOrder;
    if (!o || !f) return;
    let v = t.value === "" ? (f === "minute" ? 0 : 0) : Number(t.value);
    if (f === "minute") v = Math.max(0, Math.min(119, Math.round(v)));
    (o as unknown as Record<string, number>)[f] = v;
    if (o.kind === "behaviour" && f === "playerOut") o.playerIn = v;
    changed();
  });
}

function move<T>(list: T[], i: number, dir: number) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
