// Seite „Anweisungen & Elfmeter“: Auswechslungen/Anweisungen, Elfmeterschützen und Reserve-Reihe der Bank,
// wie in HO (Reiter Aufstellung → Auswechslungen / Anweisungen, Elfmeterschützen). Logik in core/orders.ts.

import { type BenchSlot, type Lineup, type MatchOrder, type OrderKind, type Player, Role } from "../core/model";
import { CARD_DE, ORDER_KIND_DE, STANDING_DE, autoBackups, benchSlotValue, maxOrders, newOrder, orderProblems, penaltyStrength } from "../core/orders";
import { MAX_SUBSTITUTIONS, SUB_MODE_DE, type SubMode, type SubSuggestion, ruleOfThumb, suggestSubstitutions, suggestionToOrder } from "../core/substitutions";
import type { TrainingDef, WeekMinutes } from "../core/training";

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
  /** Für Auswechslungs-Vorschläge: Training, schon gespielte Minuten der Woche, Spielart (1 Liga, 3 Pokal, 4/5 Freundschaft) */
  subContext: () => { training?: TrainingDef; week?: Map<number, WeekMinutes>; matchType: number };
}

interface Stored {
  matchId: number;
  orders: MatchOrder[];
  /** selbst gesetzte Elfmeterschützen in Reihenfolge; der Rest wird automatisch wie HO aufgefüllt */
  penalties: number[];
  /** Spieler, die nie automatisch als Schütze kommen sollen */
  excluded: number[];
  /** eigene Reserve je Bankplatz (0 = keine), fehlende Plätze automatisch */
  backups: Partial<Record<BenchSlot, number>>;
  /** gewählter Modus der Auswechslungs-Vorschläge; fehlt = nach Spielart */
  subMode?: SubMode;
}

const empty = (matchId: number): Stored => ({ matchId, orders: [], penalties: [], excluded: [], backups: {} });
let store: Stored = empty(0);
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
  store = s && s.matchId === matchId && Array.isArray(s.orders) ? { ...empty(matchId), ...s, penalties: s.penalties ?? [], excluded: s.excluded ?? [], backups: s.backups ?? {} } : empty(matchId);
}

const inLineup = (l: Pick<Lineup, "positions" | "bench">) => new Set([...l.positions.map((p) => p.playerId), ...(Object.values(l.bench).filter(Boolean) as number[])]);

/** Elfmeterschützen: eigene zuerst, Rest automatisch aus Startelf und Bank; passt sich jeder Aufstellung an */
function penaltiesFor(l: Lineup, byId: Map<number, Player>): { ids: number[]; fixed: number } {
  const inL = inLineup(l);
  const fixed = store.penalties.filter((id) => inL.has(id)).slice(0, 11);
  const skip = new Set([...fixed, ...store.excluded]);
  const rest = [...inL].map((id) => byId.get(id)).filter((p): p is Player => !!p && !skip.has(p.id)).sort((a, b) => penaltyStrength(b) - penaltyStrength(a)).map((p) => p.id);
  return { ids: [...fixed, ...rest].slice(0, 11), fixed: fixed.length };
}

/** Aufstellung samt Reserve-Reihe, Elfmeterschützen und Anweisungen für den HRF-Export */
export function withOrders(l: Lineup, byId: Map<number, Player>): Lineup {
  return { ...l, backups: autoBackups(l.bench, byId, store.backups), penaltyTakers: penaltiesFor(l, byId).ids, orders: store.orders.map((o) => ({ ...o })) };
}

/** Geplante Auswechslungen und Positionstausche für die Anzeige auf Feld und Bank */
export interface PlannedMove {
  kind: "out" | "in" | "swap";
  minute: number;
  /** der andere Spieler */
  other: number;
  /** Bedingung als Text, leer = immer */
  cond: string;
}

export function plannedMoves(): Map<number, PlannedMove[]> {
  const map = new Map<number, PlannedMove[]>();
  const add = (id: number, m: PlannedMove) => id && map.set(id, [...(map.get(id) ?? []), m]);
  for (const o of store.orders) {
    const cond = [o.standing >= 0 ? STANDING_DE.find(([v]) => v === o.standing)?.[1] : "", o.card >= 0 ? CARD_DE.find(([v]) => v === o.card)?.[1] : ""].filter(Boolean).join(", ");
    if (o.kind === "sub" && o.playerOut && o.playerIn) {
      add(o.playerOut, { kind: "out", minute: o.minute, other: o.playerIn, cond });
      add(o.playerIn, { kind: "in", minute: o.minute, other: o.playerOut, cond });
    } else if (o.kind === "swap" && o.playerOut && o.playerIn) {
      add(o.playerOut, { kind: "swap", minute: o.minute, other: o.playerIn, cond });
      add(o.playerIn, { kind: "swap", minute: o.minute, other: o.playerOut, cond });
    }
  }
  return map;
}

/** Fehler in den Anweisungen, die das Speichern verhindern */
export function ordersBlocking(l: Lineup, byId: Map<number, Player>, tacticalAssistants: number): string[] {
  return orderProblems(store.orders, l, byId, tacticalAssistants).flatMap((ps, i) => ps.map((p) => `Anweisung ${i + 1} (${ORDER_KIND_DE[store.orders[i].kind]}): ${p}`));
}

/** Kurzfassung für „Für HO speichern“: was außer Feld, Bank, Kapitän und Standards mitgeht */
export function ordersSummary(l: Lineup, byId: Map<number, Player>): string {
  const n = store.orders.length;
  const backups = Object.keys(autoBackups(l.bench, byId, store.backups)).length;
  const pens = penaltiesFor(l, byId).ids.length;
  return `${backups} Reserven · ${pens} Elfmeterschützen · ${n ? `${n} ${n === 1 ? "Anweisung" : "Anweisungen"}` : "keine Anweisungen"}`;
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
  const { ids: pens, fixed } = penaltiesFor(l, byId);
  const ids = inLineup(l);
  const field = new Set(l.positions.map((p) => p.playerId));
  const cands = [...ids].map((id) => byId.get(id)).filter((p): p is Player => !!p && !pens.includes(p.id)).sort((a, b) => penaltyStrength(b) - penaltyStrength(a));
  const penRow = (id: number, i: number) => {
    const p = byId.get(id);
    if (!p) return "";
    return `<li><span class="pen-n">${i + 1}</span><span class="pen-name">${esc(p.name)}${i >= fixed ? ' <span class="tag">auto</span>' : ""}<span class="sub"> ${field.has(id) ? "Startelf" : "Bank"} · Erf. ${p.experience}, Std. ${p.setPieces}, Tor ${p.scoring}</span></span><span class="pen-v">${de(penaltyStrength(p))}</span>
      <button class="btn icon sm" data-pmove="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Nach oben">↑</button>
      <button class="btn icon sm" data-pmove="${i}" data-dir="1" ${i === pens.length - 1 ? "disabled" : ""} aria-label="Nach unten">↓</button>
      <button class="btn icon sm" data-pdel="${id}" aria-label="Entfernen">✕</button></li>`;
  };

  // Reserve-Reihe
  const benchIds = BENCH_NAME.map(([s]) => l.bench[s] ?? 0).filter(Boolean);
  const backups = autoBackups(l.bench, byId, store.backups);
  const backupRow = ([slot, label]: [BenchSlot, string]) => {
    const own = l.bench[slot];
    const others = benchIds.filter((id) => id !== own).sort((a, b) => benchSlotValue(byId.get(b)!, slot) - benchSlotValue(byId.get(a)!, slot));
    const auto = autoBackups(l.bench, byId)[slot];
    const mine = slot in store.backups && (store.backups[slot] === 0 || backups[slot] === store.backups[slot]);
    const cur = mine ? store.backups[slot]! : -1;
    const name = (id?: number) => (id ? (byId.get(id)?.name ?? `ID ${id}`) : "");
    return `<label>${label}: <b class="bk-own">${own ? esc(name(own)) : "leer"}</b><select data-backup="${slot}" ${own ? "" : "disabled"}>${opt(-1, auto ? `automatisch: ${name(auto)}` : "automatisch", cur)}${opt(0, "keine Reserve", cur)}${others.map((id) => opt(id, name(id), cur)).join("")}</select></label>`;
  };

  root.innerHTML = `
    <section class="mplan sect" id="secSubs">
      <h3><span class="step">3</span>Auswechslungen &amp; Anweisungen <span class="sub">${counted} von ${limit} Anweisungen (5 + Taktik-Assistent Stufe ${ta})${hasMarking ? " · plus 1 Manndeckung" : ""} · davon höchstens ${MAX_SUBSTITUTIONS} Wechsel</span></h3>
      ${suggestionsBlock(l, byId)}
      <div class="mp-head sect-sub">Deine Anweisungen</div>
      <div class="controls ord-add">${addBtn("sub", "Auswechslung", full)}${addBtn("behaviour", "Verhalten", full)}${addBtn("swap", "Positionstausch", full)}${addBtn("marking", "Manndeckung", hasMarking)}
        ${store.orders.length ? `<button class="btn" data-oclear>Alle löschen</button>` : ""}</div>
      ${store.orders.map((o, i) => renderOrder(o, i, store.orders.length, l, byId, problems[i])).join("") || `<p class="sub">Noch keine Anweisungen. Ohne Anweisungen wechselt Hattrick nur bei Verletzungen aus.</p>`}
      <p class="sub">Bedingungen wie in Hattrick: Die Anweisung gilt ab der Minute, sobald Spielstand und Rote Karten passen. Hattrick führt die Anweisungen in dieser Reihenfolge aus. Spieler, die nicht mehr in der Aufstellung stehen, werden rot markiert.</p>
    </section>
    <section class="mplan sect" id="secPens">
      <h3><span class="step">4</span>Elfmeterschützen <span class="sub">${pens.length} von 11 · ${fixed ? `${fixed} von dir, Rest automatisch` : "automatisch wie HO"}</span></h3>
      ${fixed || store.excluded.length ? `<div class="controls"><button class="btn" data-pauto>Wieder alles automatisch</button></div>` : ""}
      ${pens.length ? `<ol class="pen-list">${pens.map(penRow).join("")}</ol>` : `<p class="sub">Keine Schützen. Dann wählt Hattrick selbst.</p>`}
      ${cands.length && pens.length < 11 ? `<div class="pen-add"><span class="sub">Hinzufügen:</span> ${cands.map((p) => `<button class="chipbtn" data-padd="${p.id}">${esc(p.name.split(" ").slice(-1)[0])} <span class="sub">${de(penaltyStrength(p))}</span></button>`).join("")}</div>` : ""}
      <p class="sub">Aus Startelf und Bank, stärkste zuerst wie HO (1,5 × Erfahrung + 0,7 × Standards + 0,3 × Torschuss, mit Form und Treue, Ballzauberer +10 %). Verschieben macht die Reihenfolge zu deiner, neue Spieler der Aufstellung werden hinten automatisch ergänzt. Gilt fürs Elfmeterschießen (Pokal und Entscheidungsspiele).</p>
    </section>
    <section class="mplan sect" id="secBackup">
      <h3><span class="step">5</span>Reserve der Ersatzbank <span class="sub">zweite Reihe in HO · passt sich der Bank an</span></h3>
      <p class="sub">Wird für eine Position ein Ersatz gebraucht (Verletzung) und der Bankspieler dieses Platzes ist schon im Spiel, kommt die Reserve. Sie sitzt selbst auf einem anderen Bankplatz, bringt also keinen zusätzlichen Spieler. Automatisch: der stärkste andere Bankspieler für diese Position.</p>
      <div class="controls bk-grid">${BENCH_NAME.map(backupRow).join("")}</div>
    </section>`;
}

// --- Auswechslungs-Vorschläge -------------------------------------------------------------

const defaultMode = (matchType: number): SubMode => (matchType === 3 ? "sieg" : matchType === 1 ? "ausgewogen" : "training");
const MODE_HINT: Record<SubMode, string> = {
  sieg: "nur Wechsel, die die Mannschaft stärker machen (müde Spieler raus). Einsätze fürs Mitspielen nur bei mehr als 2 Toren Vorsprung.",
  ausgewogen: "Konditionswechsel plus Training und Einsatzzeit, solange die Mannschaft übers Spiel höchstens 2 % Stärke verliert.",
  training: "Trainingsminuten und Einsätze gehen vor, Stärke zählt wenig. Für Freundschaftsspiele.",
};
const REASON_TAG: Record<SubSuggestion["reason"], string> = { kondition: "Kondition", training: "Training", einsatz: "Einsatz" };

let lastSuggestions: SubSuggestion[] = [];

function currentMode(): SubMode {
  return store.subMode ?? defaultMode(ctx?.subContext().matchType ?? 1);
}

function suggestionsBlock(l: Lineup, byId: Map<number, Player>): string {
  const sc = ctx!.subContext();
  const mode = currentMode();
  const existing = store.orders.filter((o) => o.kind === "sub").length;
  lastSuggestions = suggestSubstitutions({ lineup: l, byId, mode, training: sc.training, week: sc.week, existing: store.orders });
  const full = store.orders.filter((o) => o.kind !== "marking").length >= maxOrders(ctx!.tacticalAssistants());
  const name = (id: number) => esc(byId.get(id)?.name ?? `ID ${id}`);
  const row = (s: SubSuggestion, i: number) => `<li class="sug-row">
      <span class="sug-min">${s.minute}′</span>
      <span class="sug-main"><b>${name(s.playerOut)}</b> <span class="sub">${ROLE_SHORT[s.role] ?? ""}</span> → <b>${name(s.playerIn)}</b> <span class="tag sug-${s.reason}">${REASON_TAG[s.reason]}</span>
        <span class="sub sug-why">${esc(s.text)}</span></span>
      <button class="btn sm" data-sadd="${i}" ${full ? "disabled" : ""}>Übernehmen</button></li>`;
  const thumbs = ruleOfThumb();
  const fmt = (m: number | null) => (m === null ? "–" : `${m}′`);
  const modeBtn = (m: SubMode) => `<button class="${m === mode ? "on" : ""}" data-smode="${m}">${SUB_MODE_DE[m]}</button>`;
  return `<div class="mp-box sug-block">
      <div class="mp-head">Vorschläge <span class="sug-sub">nach Kondition, Training und Einsatzzeit${existing ? ` · ${existing} von ${MAX_SUBSTITUTIONS} Wechseln schon geplant` : ""}</span></div>
      <div class="controls"><div class="seg" role="group" aria-label="Ziel">${(["sieg", "ausgewogen", "training"] as SubMode[]).map(modeBtn).join("")}</div>
        ${lastSuggestions.length > 1 ? `<button class="btn" data-saddall ${full ? "disabled" : ""}>Alle übernehmen</button>` : ""}</div>
      <p class="sub">${SUB_MODE_DE[mode]}: ${MODE_HINT[mode]}${store.subMode ? "" : " (passend zur Spielart gewählt)"}</p>
      ${lastSuggestions.length ? `<ol class="sug-list">${lastSuggestions.map(row).join("")}</ol>` : `<p class="sub">${existing >= MAX_SUBSTITUTIONS ? "Alle 3 Wechsel sind schon verplant." : "Kein Wechsel lohnt sich: Die Startelf hält konditionell durch, und auf der Bank wartet niemand mit Trainings- oder Einsatzbedarf."}</p>`}
      <details class="sug-rules"><summary>Wie gerechnet wird</summary>
        <p class="sub"><b>Kondition:</b> Jeder Spieler baut ab Anpfiff ab, erholt sich zur Halbzeit teilweise und baut weiter ab, ein Einwechselspieler startet frisch (Modell aus HO). TopHatt sucht je Startspieler und Bankspieler die Minute, ab der die Mannschaft mit dem frischen Ersatz insgesamt stärker ist. Faustregel (Ersatz mit Kondition 6):</p>
        <table class="sug-table"><thead><tr><th>Kondition</th><th>Ersatz gleich stark</th><th>10 % schwächer</th><th>20 % schwächer</th></tr></thead>
          <tbody>${thumbs.map((r) => `<tr><td>${r.stamina}</td>${r.minutes.map((m) => `<td>${fmt(m)}</td>`).join("")}</tr>`).join("")}</tbody></table>
        <p class="sub"><b>Training:</b> Minuten auf Trainingsposition aus allen Spielen der Woche zählen, höchstens 90, schon 1 Minute zählt. Aufteilen bringt insgesamt nicht mehr Training, es lohnt sich nur, wenn der Einwechselspieler mehr davon hat (jünger, Fertigkeit niedriger) oder der Startspieler seine 90 Minuten der Woche schon voll hat.</p>
        <p class="sub"><b>Einsatz:</b> Für die Form zählt laut Hattrick-Regeln, ob ein Spieler in der Woche überhaupt gespielt hat, nicht wie lange. Wer gar nicht spielt, bekommt außerdem nur 50 % Konditionstraining statt mindestens 75 %. Ein kurzer Einsatz reicht also schon.</p>
      </details>
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
    if (d.smode) store.subMode = d.smode as SubMode;
    else if (d.sadd !== undefined) {
      const sg = lastSuggestions[Number(d.sadd)];
      if (sg) store.orders.push(suggestionToOrder(sg));
    } else if (d.saddall !== undefined) {
      const room = maxOrders(ctx.tacticalAssistants()) - store.orders.filter((o) => o.kind !== "marking").length;
      store.orders.push(...lastSuggestions.slice(0, Math.max(0, room)).map(suggestionToOrder));
    } else if (d.oadd) store.orders.push(newOrder(d.oadd as OrderKind));
    else if (d.odel !== undefined) store.orders.splice(Number(d.odel), 1);
    else if (d.omove !== undefined) move(store.orders, Number(d.omove), Number(d.dir));
    else if (d.oclear !== undefined) store.orders = [];
    else if (d.pauto !== undefined) {
      store.penalties = [];
      store.excluded = [];
    } else if (d.padd) {
      const id = Number(d.padd);
      store.penalties = [...penaltiesFor(l, byId).ids, id].slice(0, 11);
      store.excluded = store.excluded.filter((x) => x !== id);
    } else if (d.pdel) {
      const id = Number(d.pdel);
      store.penalties = store.penalties.filter((x) => x !== id);
      store.excluded = [...store.excluded.filter((x) => x !== id), id];
    } else if (d.pmove !== undefined) {
      const list = penaltiesFor(l, byId).ids;
      move(list, Number(d.pmove), Number(d.dir));
      store.penalties = list.slice(0, Math.max(Number(d.pmove), Number(d.pmove) + Number(d.dir)) + 1);
    } else return;
    changed();
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.backup) {
      const b = { ...store.backups };
      if (Number(t.value) < 0) delete b[t.dataset.backup as BenchSlot];
      else b[t.dataset.backup as BenchSlot] = Number(t.value);
      store.backups = b;
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
