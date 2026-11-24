// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Seite „Transfers“: Suchprofile in Kaufreihenfolge mit einem gemeinsamen Budget, das den Finanz-Puffer hält,
// Preisprüfung für konkrete Kandidaten, Verkäufe als Geldquelle und die bisherigen Transfers aus HO.

import type { Advice } from "../core/advisor";
import { DEFAULT_HORIZON, RULES, checkAffordability, type FinanceSnapshot, type NormalWeek, type PastWeek } from "../core/finance";
import type { HoTransfer } from "../core/hodata";
import { loc } from "../core/locale";
import type { Player, TeamInfo } from "../core/model";
import { budget, type SearchProfile } from "../core/scouting";
import { type Commitment, type RankedProfile, maxPrice, rankProfiles, transferTotals } from "../core/transferplan";
import type { SquadPlan } from "../core/squadplan";
import { financeAssumptions } from "./finance-view";

export interface TransferContext {
  players: Player[];
  team: TeamInfo;
  finance: FinanceSnapshot | null;
  financeHistory: PastWeek[];
  profiles: SearchProfile[];
  advice: Advice;
  /** Kaderplanung: Lücken, Überzählige (dieselbe Planung wie die Seite Kaderplanung) */
  squadPlan: SquadPlan | null;
  /** Startelf und Bank der Grundlage (wie Schwachstellen) */
  starters: Set<number>;
  bench: Set<number>;
  /** null = keine HO-Daten oder ältere tophatt-data.json ohne Transfers */
  transfers: HoTransfer[] | null;
  hoLoaded: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const eur = (x: number) => `${(Math.round(x) || 0).toLocaleString(loc())} €`;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x)).toLocaleString(loc())} €`;
const fmtDate = (d: Date) => (isNaN(d.getTime()) ? "–" : d.toLocaleDateString(loc(), { day: "2-digit", month: "2-digit", year: "numeric" }));
const best = (p: Player) => Math.max(p.keeper, p.defending, p.playmaking, p.winger, p.scoring, p.passing);

const VERDICT = {
  ok: { cls: "good", icon: "✓", word: "Tragbar" },
  knapp: { cls: "warning", icon: "!", word: "Knapp" },
  gefahr: { cls: "critical", icon: "✕", word: "Gefahr" },
} as const;

/** Eingaben bleiben beim Neuzeichnen erhalten (Schlüssel: Titel des Suchprofils bzw. Spieler-ID) */
const buys = new Map<string, { price: number | null; salary: number | null }>();
const sells = new Map<number, { on: boolean; price: number | null }>();

let root: HTMLElement | null = null;
let ctx: TransferContext | null = null;
let ranked: RankedProfile[] = [];

// Puffer oder Zuschauer auf der Seite Finanzen geändert
if (typeof document !== "undefined") {
  document.addEventListener("tophatt:finance-assumptions", () => update());
  // Link „Suchprofil ansehen“ (Kaderplanung): zur passenden Karte springen, Lücke vor anderen Profilen derselben Gruppe
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-profile]");
    const g = a?.dataset.profile;
    if (!g) return;
    setTimeout(() => {
      const el = root?.querySelector<HTMLElement>(`.tr-card[data-group="${g}"][data-kind="luecke"]`) ?? root?.querySelector<HTMLElement>(`.tr-card[data-group="${g}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }, 80);
  });
}

export function renderTransfers(el: HTMLElement, c: TransferContext) {
  root = el;
  ctx = c;
  ranked = rankProfiles(c.profiles, c.advice, c.players);
  // Eingaben zu Profilen/Spielern, die es nicht mehr gibt, verwerfen
  for (const k of [...buys.keys()]) if (!ranked.some((r) => r.profile.title === k)) buys.delete(k);
  for (const k of [...sells.keys()]) if (!sellable(c).some((x) => x.player.id === k)) sells.delete(k);
  el.innerHTML = skeleton(c);
  wire(el);
  update();
}

/** Finanzannahmen: wie auf der Seite Finanzen; ohne Finanzdaten nur der Kontostand */
function money(c: TransferContext): { s: Pick<FinanceSnapshot, "expectedCash">; normal: NormalWeek | null; buffer: number; withForecast: boolean } {
  if (c.finance) {
    const a = financeAssumptions(c.finance, c.financeHistory);
    return { s: c.finance, normal: a.normal, buffer: a.buffer, withForecast: true };
  }
  const cash = c.team.expectedCash ?? c.team.cash;
  const B = budget(c.players, cash);
  // ohne Prognose: altes Verfahren, fünf Wochen Gehälter als Rücklage, keine Einnahmen
  return { s: { expectedCash: cash }, normal: null, buffer: B.reserve, withForecast: false };
}

const buyOf = (r: RankedProfile) => buys.get(r.profile.title) ?? { price: null, salary: null };

/** Alles Eingetragene außer dem Profil `skip`: Käufe kosten, Verkäufe bringen Geld und sparen Gehalt */
function commitment(skip: number | null): Commitment {
  const c: Commitment = { oneTime: 0, weekly: 0 };
  ranked.forEach((r, i) => {
    if (i === skip) return;
    const b = buyOf(r);
    if (b.price === null) return;
    c.oneTime += b.price;
    c.weekly += b.salary ?? r.salary;
  });
  for (const [id, x] of sells) {
    if (!x.on) continue;
    const p = ctx!.players.find((q) => q.id === id);
    c.oneTime -= x.price ?? 0;
    c.weekly -= p?.salary ?? 0;
  }
  return c;
}

/** Ein Ersatz für eine Lücke muss nicht teuer sein: Richtwert ein Viertel des freien Budgets */
export const GAP_SHARE = 0.25;

/**
 * Karten vor `i` ohne eingetragenen Preis, mit denen die Rechnung für Karte `i` vorab rechnet:
 * Lücken mit ihrem Richtwert, dazu die erste Verstärkung mit ihrem vollen Höchstgebot.
 */
function assumedBefore(i: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < i; j++) {
    if (buyOf(ranked[j]).price !== null) continue;
    out.push(j);
    if (ranked[j].profile.kind !== "luecke") break;
  }
  return out;
}

/** Höchstgebot für Profil i jetzt (oder in `atWeek` Wochen). Für Lücken höchstens der Richtwert. */
function capFor(i: number, atWeek = 0): number {
  const m = money(ctx!);
  const normal = m.normal ?? { total: 0 };
  const c = commitment(i);
  for (const j of assumedBefore(i)) {
    c.oneTime += capFor(j);
    c.weekly += ranked[j].salary;
  }
  const r = ranked[i];
  const salary = buyOf(r).salary ?? r.salary;
  const full = m.withForecast ? maxPrice(m.s, normal, m.buffer, c, salary, atWeek) : Math.max(0, Math.floor((m.s.expectedCash - m.buffer - c.oneTime) / 1000) * 1000);
  if (r.profile.kind !== "luecke" || atWeek > 0) return full;
  const free = m.withForecast ? maxPrice(m.s, normal, m.buffer, commitment(null), salary) : full;
  return Math.min(full, Math.floor((free * GAP_SHARE) / 1000) * 1000);
}

function skeleton(c: TransferContext): string {
  const m = money(c);
  const tile = (k: string, v: string, sub: string, cls = "") => `<div class="tile fin-tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`;
  const tiles = m.withForecast
    ? `<div class="tiles show fin-tiles">
        ${tile("Erwartet zum Update", eur(m.s.expectedCash), "Kontostand zum nächsten Wirtschaftsupdate", m.s.expectedCash < 0 ? "neg" : "")}
        <div class="tile fin-tile"><div class="k">Typische Woche</div><div class="v" id="trWeek"></div><div class="sub">Überschuss pro Woche ohne Transfers</div></div>
        <div class="tile fin-tile"><div class="k">Mindest-Puffer</div><div class="v" id="trBuffer"></div><div class="sub">einstellbar auf der Seite Finanzen</div></div>
        <div class="tile fin-tile"><div class="k">Freies Budget</div><div class="v" id="trFree"></div><div class="sub" id="trFreeSub"></div></div>
      </div>`
    : `<p class="focus">Die geladene HRF-Datei enthält keine Finanzdaten. Budget deshalb vereinfacht: Kontostand ${eur(m.s.expectedCash)} minus fünf Wochen Gehälter (${eur(m.buffer)}), ohne Einnahmen-Prognose.</p>`;

  const cards = ranked.length
    ? `<div class="profiles">${ranked.map((r, i) => card(r, i)).join("")}</div>
      <p class="sub">Alle Suchprofile teilen sich ein Budget. Das Höchstgebot ist so berechnet, dass der Kontostand nach dem Kauf eine ganze Saison (${DEFAULT_HORIZON} Wochen) lang über dem Puffer bleibt, mit Gehalt des neuen Spielers und typischen Wocheneinnahmen. Trag den Preis und das Gehalt eines konkreten Spielers vom Transfermarkt ein, dann rechnen alle Karten und der Plan unten damit. Werte so im Transfermarkt eintragen (Fertigkeit von/bis, Alter von/bis). Hauptfertigkeit zwei Stufen über dem schwächsten Stammspieler, weil gekaufte Spieler anfangs keine Treue haben.</p>`
    : `<p class="focus ok">Kein dringender Transferbedarf: keine deutliche Schwachstelle und keine Lücke in der Kaderplanung.</p>`;

  const A = c.advice;
  return `
    ${tiles}
    <h3>Suchprofile in Kaufreihenfolge</h3>
    ${cards}
    <h3>Verkaufen, um Geld frei zu machen</h3>
    ${sellTable(c)}
    <h3>Dein Transferplan</h3>
    <div id="trPlan"></div>
    <h3>Bisherige Transfers</h3>
    ${pastTable(c)}
    ${A.summary.filter((s) => !/Verkauf prüfen/.test(s)).map((s) => `<p class="focus ok">${esc(s)}</p>`).join("")}
    <h3>Wo eine Verstärkung am meisten bringt</h3>
    <div class="scroll"><table class="nowrap"><thead><tr><th>Position</th><th>Fertigkeit</th><th>Spielt jetzt</th><th class="num">+1 Stufe</th><th class="num">+2 Stufen</th><th>Hilft bei Schwachstelle</th></tr></thead><tbody>
    ${A.upgrades.map((u) => `<tr><td>${u.position}</td><td>${u.skill}</td><td>${esc(u.currentPlayer)}</td><td class="num">+${u.gainPlus1.toFixed(1)}</td><td class="num">+${u.gainPlus2.toFixed(1)}</td><td>${u.helps.length ? esc(u.helps.join(", ")) : '<span class="muted">nein</span>'}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="sub">Zuwachs an HatStats, wenn auf dieser Position ein sonst gleicher Spieler mit höherer Fertigkeit stünde. Sortiert nach dem Zuwachs in den Schwachstellen (gleiche Grundlage wie die Seite Schwachstellen). Ein Torwart oder Innenverteidiger hebt alle drei Abwehrteile gleichzeitig und hat deshalb oft viele HatStats, hilft aber nur, wenn die Abwehr eine Schwachstelle ist. Gekaufte Spieler haben anfangs keine Treue, sie brauchen deshalb etwa eine Stufe mehr.</p>
    <h3>Trainingskandidaten</h3>
    <ul>${A.trainingTargets.map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.reason)}</li>`).join("")}</ul>`;
}

function card(r: RankedProfile, i: number): string {
  const p = r.profile;
  const b = buyOf(r);
  const benefit =
    p.kind === "luecke"
      ? `<b>Schließt die Lücke</b> aus der Kaderplanung. Ohne Ersatz fehlt bei Verletzung oder Sperre ein brauchbarer Spieler.`
      : r.gain === null
      ? `<span class="muted">Nutzen später: Nachfolger, wird über die Saisons stärker.</span>`
      : r.gain < 0.3
        ? `<span class="muted">Bringt sofort kaum etwas (+${r.gain.toFixed(1)} HatStats).</span>`
        : r.helpsWeak
          ? `<b>+${r.gain.toFixed(1)} HatStats</b> in den Schwachstellen.`
          : `<b>+${r.gain.toFixed(1)} HatStats</b>, aber nicht in einer Schwachstelle.`;
  const label = p.kind === "luecke" ? "Lücke schließen" : i === 0 || ranked.slice(0, i).every((x) => x.profile.kind === "luecke") ? "Größter Hebel" : "Danach";
  return `<div class="profile tr-card${i === 0 ? " first" : ""}" data-rank="${i}" data-group="${p.group}" data-kind="${p.kind}">
    <div class="tr-rank"><span class="badge">${i + 1}.</span> <span>${label}</span></div>
    <h4>${esc(p.title)}</h4><div class="sub">${esc(p.reason)}</div>
    <p class="tr-benefit">${benefit}</p>
    <dl>
      <dt>Alter</dt><dd>${p.age[0]} bis ${p.age[1]} Jahre</dd>
      ${p.skills.map((k) => `<dt>${esc(k.name)}</dt><dd>${k.max ? `${k.min} bis ${k.max}` : `ab ${k.min}`}</dd>`).join("")}
      <dt>Gehalt ca.</dt><dd>${eur(r.salary)} pro Woche</dd>
      <dt>${p.kind === "luecke" ? "Richtwert" : "Höchstgebot"}</dt><dd id="trCap${i}"></dd>
    </dl>
    <div class="tr-later sub" id="trLater${i}"></div>
    <div class="tr-inputs">
      <label>Preis Kandidat<input type="number" min="0" step="1000" data-buy-price="${i}" value="${b.price ?? ""}" placeholder="€"></label>
      <label>Gehalt pro Woche<input type="number" min="0" step="10" data-buy-salary="${i}" value="${b.salary ?? ""}" placeholder="${Math.round(r.salary)}"></label>
    </div>
    <div class="tr-check" id="trCheck${i}"></div>
  </div>`;
}

interface Sellable {
  player: Player;
  reason: string;
}

/** Verkaufskandidaten: die Überzähligen aus der Kaderplanung, ohne Kaderplanung die Spieler ohne Platz in Elf und Bank */
function sellable(c: TransferContext): Sellable[] {
  if (c.squadPlan)
    return c.squadPlan.players
      .filter((x) => x.role === "surplus")
      .sort((a, b) => b.player.salary - a.player.salary)
      .map((x) => ({ player: x.player, reason: x.reason }));
  const reason = new Map(c.advice.sellCandidates.map((s) => [s.playerId, s.reason]));
  return c.advice.unused
    .map((id) => c.players.find((p) => p.id === id))
    .filter((p): p is Player => !!p && reason.has(p.id))
    .map((p) => ({ player: p, reason: reason.get(p.id)! }));
}

function sellTable(c: TransferContext): string {
  const list = sellable(c);
  if (!list.length) return `<p class="muted">Kein Spieler ist überzählig.</p>`;
  const row = ({ player: p, reason }: Sellable) => {
    const x = sells.get(p.id);
    return `<tr><td><label class="check"><input type="checkbox" data-sell="${p.id}"${x?.on ? " checked" : ""}> verkaufen</label></td>
      <td>${esc(p.name)}</td><td class="num">${p.age}</td><td class="num">${best(p)}</td><td class="num">${p.tsi.toLocaleString(loc())}</td>
      <td class="num">${eur(p.salary)}</td><td class="num">${eur(p.salary * DEFAULT_HORIZON)}</td>
      <td><input type="number" min="0" step="1000" data-sell-price="${p.id}" value="${x?.price ?? ""}" placeholder="€" style="width:110px"></td>
      <td class="sub">${esc(reason)}</td></tr>`;
  };
  const head = `<thead><tr><th>Verkaufen</th><th>Spieler</th><th class="num">Alter</th><th class="num">Beste Fertigkeit</th><th class="num">TSI</th><th class="num">Gehalt/Woche</th><th class="num">pro Saison</th><th>Erlös</th><th>Hinweis</th></tr></thead>`;
  return `<p class="sub">${c.squadPlan ? "Dieselben Spieler, die die Kaderplanung als überzählig zeigt. " : ""}Ein Verkauf bringt Geld und spart Gehalt. Hake an, wen du verkaufen willst, und trag den erwarteten Erlös ein (vergleichbare Spieler auf dem Transfermarkt; Heimatverein und Vorverein bekommen davon einen kleinen Anteil). Das Geld steht dann allen Suchprofilen zur Verfügung.</p>
    <div class="scroll"><table class="nowrap tr-sell">${head}<tbody>${list.map(row).join("")}</tbody></table></div>`;
}

function pastTable(c: TransferContext): string {
  if (!c.hoLoaded) return `<p class="muted">Bisherige Transfers kommen aus der HO-Datenbank. TopHatt mit TopHatt.bat starten, dann erscheinen sie hier.</p>`;
  if (c.transfers === null)
    return `<p class="muted">Die geladene tophatt-data.json enthält noch keine Transfers. TopHatt einmal mit der neuen TopHatt.bat starten (der Sync liest sie aus HO).</p>`;
  if (!c.transfers.length) return `<p class="muted">In HO sind keine Transfers gespeichert. In HO „Daten herunterladen“ ausführen, dann TopHatt neu starten.</p>`;
  const rate = c.team.currencyRate || 10;
  const tid = c.team.teamId;
  const T = transferTotals(c.transfers, tid, rate);
  const inSquad = new Set(c.players.map((p) => p.id));
  const status = (x: HoTransfer) => {
    if (x.buyerId !== tid) return `<span class="muted">verkauft</span>`;
    if (!inSquad.has(x.playerId)) return `<span class="muted">nicht mehr im Kader</span>`;
    if (c.starters.has(x.playerId)) return `<span class="status good"><i>✓</i>Startelf</span>`;
    if (c.bench.has(x.playerId)) return `<span class="status warning"><i>!</i>Bank</span>`;
    return `<span class="status critical"><i>✕</i>nicht aufgestellt</span>`;
  };
  return `<div class="scroll"><table class="nowrap"><thead><tr><th>Datum</th><th>Spieler</th><th>Art</th><th>Verein</th><th class="num">Preis</th><th class="num">TSI</th><th>Heute</th></tr></thead><tbody>
    ${c.transfers
      .map((x) => {
        const bought = x.buyerId === tid;
        return `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.playerName)}</td><td>${bought ? "Kauf" : "Verkauf"}</td><td>${esc(bought ? x.sellerName : x.buyerName)}</td>
          <td class="num ${bought ? "neg" : "pos"}">${eur(x.price / rate)}</td><td class="num">${x.tsi.toLocaleString(loc())}</td><td>${status(x)}</td></tr>`;
      })
      .join("")}
    </tbody><tfoot><tr><th colspan="4"><span>Gekauft: ${T.bought}</span> · <span>verkauft: ${T.sold}</span></th><th class="num ${T.earned - T.spent < 0 ? "neg" : "pos"}">${signed(T.earned - T.spent)}</th><th colspan="2"></th></tr></tfoot></table></div>
    <p class="sub">Aus HOs Transferliste des Vereins. Preise ohne Gebühren für Heimatverein und Vorverein.</p>`;
}

function wire(el: HTMLElement) {
  el.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const val = t.value.trim() === "" ? null : Math.max(0, Number(t.value) || 0);
    if (t.dataset.buyPrice !== undefined || t.dataset.buySalary !== undefined) {
      const r = ranked[Number(t.dataset.buyPrice ?? t.dataset.buySalary)];
      const b = { ...buyOf(r) };
      if (t.dataset.buyPrice !== undefined) b.price = val;
      else b.salary = val;
      buys.set(r.profile.title, b);
    } else if (t.dataset.sellPrice !== undefined) {
      const id = Number(t.dataset.sellPrice);
      const x = sells.get(id) ?? { on: false, price: null };
      // ein eingetragener Erlös heißt: einplanen
      sells.set(id, { on: val !== null ? true : x.on, price: val });
      const box = el.querySelector<HTMLInputElement>(`[data-sell="${id}"]`);
      if (box) box.checked = sells.get(id)!.on;
    } else return;
    update();
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.sell === undefined) return;
    const id = Number(t.dataset.sell);
    sells.set(id, { on: t.checked, price: sells.get(id)?.price ?? null });
    update();
  });
}

function update() {
  if (!root || !ctx) return;
  const m = money(ctx);
  const q = <T extends HTMLElement>(sel: string) => root!.querySelector<T>(sel);
  if (q("#trFree")) {
    // für alle Suchprofile zusammen, mit dem Gehalt der teuersten Karte
    const salary = ranked.length ? Math.max(...ranked.map((r) => buyOf(r).salary ?? r.salary)) : 0;
    q("#trFree")!.textContent = eur(maxPrice(m.s, m.normal ?? { total: 0 }, m.buffer, commitment(null), salary));
    q("#trFreeSub")!.textContent = `für alle Suchprofile zusammen; Puffer hält ${DEFAULT_HORIZON} Wochen`;
  }
  const weekly = m.normal?.total ?? 0;
  const wk = q("#trWeek");
  if (wk) {
    wk.textContent = signed(weekly);
    wk.parentElement!.classList.toggle("neg", weekly < 0);
    wk.parentElement!.classList.toggle("pos", weekly >= 0);
    q("#trBuffer")!.textContent = eur(m.buffer);
  }
  ranked.forEach((r, i) => {
    const cap = capFor(i);
    const b = buyOf(r);
    q(`#trCap${i}`)!.textContent = cap > 0 ? `bis ${eur(cap)}` : "jetzt kein Geld frei";
    let later = "";
    if (i > 0 && m.withForecast && weekly > 0) {
      const c4 = capFor(i, 4);
      const c8 = capFor(i, 8);
      if (c8 > cap) later = `Wenn du wartest: in 4 Wochen bis ${eur(c4)}, in 8 Wochen bis ${eur(c8)}.`;
    }
    const assumed = assumedBefore(i);
    if (assumed.length && m.withForecast) {
      const gaps = assumed.every((j) => ranked[j].profile.kind === "luecke");
      const head =
        assumed.length === 1
          ? gaps
            ? `Gerechnet, als ob Nr. ${assumed[0] + 1} den Richtwert ausgibt.`
            : `Gerechnet, als ob Nr. ${assumed[0] + 1} das volle Höchstgebot ausgibt.`
          : gaps
            ? "Gerechnet, als ob die Karten davor ihren Richtwert ausgeben."
            : "Gerechnet, als ob die Karten davor Richtwert und volles Höchstgebot ausgeben.";
      later = `${head} ${later}`.trim();
    }
    if (r.profile.kind === "luecke" && m.withForecast) later = `Ein Viertel des freien Budgets reicht für Ersatzniveau. ${later}`.trim();
    q(`#trLater${i}`)!.textContent = later;
    const check = q(`#trCheck${i}`)!;
    if (b.price === null) {
      check.innerHTML = "";
      return;
    }
    const over = b.price > cap;
    const perEuro = r.gain !== null && r.gain > 0 && b.price > 0 ? ` · ${((r.gain / b.price) * 100000).toFixed(1)} HatStats je ${eur(100000)}` : "";
    check.innerHTML = over
      ? `<span class="status critical"><i>✕</i>Zu teuer</span> <span class="sub">${eur(b.price - cap)} über dem Höchstgebot${perEuro}</span>`
      : `<span class="status good"><i>✓</i>Passt</span> <span class="sub">${eur(cap - b.price)} unter dem Höchstgebot${perEuro}</span>`;
  });
  renderPlan(m);
}

function renderPlan(m: ReturnType<typeof money>) {
  const el = root!.querySelector<HTMLElement>("#trPlan")!;
  const c = commitment(null);
  const nBuys = ranked.filter((r) => buyOf(r).price !== null).length;
  const nSells = [...sells.values()].filter((x) => x.on).length;
  if (!nBuys && !nSells) {
    el.innerHTML = `<p class="muted">Noch nichts eingetragen. Trag bei einem Suchprofil den Preis eines Kandidaten ein oder hake einen Verkauf an, dann siehst du hier, wie sich der Kontostand entwickelt.</p>`;
    return;
  }
  const parts = `<span>Käufe: ${nBuys}</span> · <span>Verkäufe: ${nSells}</span> · <span>einmalig ${signed(-c.oneTime)}</span> · <span>pro Woche ${signed(-c.weekly)}</span><br>`;
  if (!m.withForecast || !ctx!.finance) {
    const left = m.s.expectedCash - c.oneTime;
    const v = left < 0 ? VERDICT.gefahr : left < m.buffer ? VERDICT.knapp : VERDICT.ok;
    el.innerHTML = `<div class="fin-verdict ${v.cls}"><span class="status ${v.cls}"><i>${v.icon}</i>${v.word}</span><div>Nach dem Plan bleiben ${eur(left)}.</div><div class="sub">${parts.replace(/<br>$/, "")}</div></div>`;
    return;
  }
  const a = checkAffordability(ctx!.finance, { oneTimeCost: c.oneTime, extraWeeklyCost: c.weekly }, { normal: m.normal!, buffer: m.buffer });
  const v = VERDICT[a.verdict];
  const wait =
    a.verdict !== "ok" && a.affordableInWeeks !== null && a.affordableInWeeks > 0
      ? a.affordableInWeeks === 1
        ? " Mit 1 Woche Ansparen hält der Puffer."
        : ` Mit ${a.affordableInWeeks} Wochen Ansparen hält der Puffer.`
      : "";
  el.innerHTML = `<div class="fin-verdict ${v.cls}">
      <span class="status ${v.cls}"><i>${v.icon}</i>${v.word}</span>
      <div>${a.text.replace(/^Tragbar: /, "")}${wait}</div>
      <div class="sub">${parts}Hattrick: ab ${RULES.spendingLimitUsd.toLocaleString(loc())} US$ Schulden sind Ausgaben eingeschränkt, ab ${RULES.bankruptcyWarningUsd.toLocaleString(loc())} US$ kommt die Bankrottwarnung, dann bleiben ${RULES.bankruptcyGraceWeeks} Wochen Zeit.</div>
    </div>`;
}
