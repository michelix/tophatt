// Seite „Finanzen“: Kontostand, Wochenbilanz, Personal und eine Was-wäre-wenn-Prognose,
// damit Trainer-/Assistenten-Investitionen den Verein nicht in die Schulden treiben.

import {
  DEFAULT_BUFFER,
  DEFAULT_HORIZON,
  RULES,
  checkAffordability,
  forecast,
  normalWeek,
  type FinanceSnapshot,
  type NormalWeek,
  type PastWeek,
  type WeekBalance,
} from "../core/finance";

/** Trainer laut Hattrick-Seite „Trainer wechseln“: Kosten pro Woche je Stufe 1–5 */
export const TRAINER_WEEKLY = [1250, 2500, 5000, 10000, 20000];
/** Kaufpreis eines Trainers von außerhalb mit Führungsqualität „passabel“ (Stand 21.11.2026) */
export const TRAINER_PRICE_EXTERNAL = [10000, 65100, 521000, 1758500, 12505200];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const eur = (x: number) => `${(Math.round(x) || 0).toLocaleString("de-DE")} €`;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x)).toLocaleString("de-DE")} €`;
const fmtDay = (s: string) => {
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
};

interface Inputs {
  trainerLevel: number; // 0 = behalten
  trainerPrice: number;
  fired: Set<number>;
  extraWeekly: number;
  oneTime: number;
  spectators: number | null; // null = Schnitt
  buffer: number;
}

const inputs: Inputs = { trainerLevel: 0, trainerPrice: 0, fired: new Set(), extraWeekly: 0, oneTime: 0, spectators: null, buffer: DEFAULT_BUFFER };
let root: HTMLElement | null = null;
let data: { snap: FinanceSnapshot; history: PastWeek[] } | null = null;

export function renderFinance(el: HTMLElement, snap: FinanceSnapshot | null, history: PastWeek[]) {
  root = el;
  if (!snap) {
    el.innerHTML = `<p class="muted">Die geladene HRF-Datei enthält keine Finanzdaten. In HO einmal „Daten herunterladen“ und neu laden.</p>`;
    data = null;
    return;
  }
  if (data?.snap.date !== snap.date) {
    inputs.fired = new Set([...inputs.fired].filter((id) => snap.staff.some((s) => s.id === id)));
  }
  data = { snap, history };
  el.innerHTML = skeleton(snap);
  wire(el);
  update();
}

function baseNormal(): NormalWeek {
  return normalWeek(data!.snap, data!.history);
}

function currentNormal(): NormalWeek {
  const n = baseNormal();
  if (inputs.spectators === null) return n;
  return { ...n, spectators: inputs.spectators, total: inputs.spectators + n.sponsors - n.costs };
}

function trainer() {
  return data!.snap.staff.find((s) => s.isTrainer) ?? null;
}

/** Plan aus den Eingaben: Wochenkosten-Änderung und Einmalkosten */
function plan() {
  const s = data!.snap;
  const t = trainer();
  let weekly = inputs.extraWeekly;
  let once = inputs.oneTime;
  if (inputs.trainerLevel > 0) {
    weekly += TRAINER_WEEKLY[inputs.trainerLevel - 1] - (t?.weeklyCost ?? 0);
    once += inputs.trainerPrice;
  }
  for (const m of s.staff) if (inputs.fired.has(m.id)) weekly -= m.weeklyCost;
  return { extraWeeklyCost: weekly, oneTimeCost: once };
}

function skeleton(s: FinanceSnapshot): string {
  const n = baseNormal();
  const t = trainer();
  const staffSum = s.staff.reduce((a, m) => a + m.weeklyCost, 0);
  const tile = (k: string, v: string, sub: string, cls = "") => `<div class="tile fin-tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`;
  return `
  <div class="tiles show fin-tiles">
    ${tile("Kontostand", eur(s.cash), `Stand ${fmtDay(s.date)}`, s.cash < 0 ? "neg" : "")}
    ${tile("Erwartet zum Update", eur(s.expectedCash), `${fmtDay(s.economyDate)}, ohne Zuschauer noch offener Heimspiele`, s.expectedCash < 0 ? "neg" : "")}
    ${tile("Typische Woche", signed(n.total), `Zuschauer im Schnitt aus ${n.basedOnWeeks} Woche${n.basedOnWeeks === 1 ? "" : "n"}`, n.total < 0 ? "neg" : "pos")}
    ${tile("Personal pro Woche", eur(staffSum), `${Math.round((staffSum / Math.max(1, n.costs)) * 100)} % der laufenden Kosten`)}
  </div>

  <h3>Was wäre wenn?</h3>
  <p class="sub">Plane Trainer-, Assistenten- oder Spezialisten-Änderungen und sieh, wie sich der Kontostand in den nächsten ${DEFAULT_HORIZON} Wochen (eine Saison) entwickelt.</p>
  <div class="fin-plan">
    <div class="controls">
      <label>Trainer<select id="finTrainer">
        <option value="0">behalten${t ? ` (Stufe ${t.level}, ${eur(t.weeklyCost)}/Woche)` : ""}</option>
        ${TRAINER_WEEKLY.map((w, i) => `<option value="${i + 1}"${inputs.trainerLevel === i + 1 ? " selected" : ""}>neuer Trainer Stufe ${i + 1} (${eur(w)}/Woche)</option>`).join("")}
      </select></label>
      <label>Kaufpreis Trainer<input id="finTrainerPrice" type="number" step="100" min="0" value="${inputs.trainerPrice}"></label>
      <label>Weitere Kosten pro Woche<input id="finExtra" type="number" step="100" value="${inputs.extraWeekly}" title="z. B. neuer Assistenztrainer; negativ = Ersparnis"></label>
      <label>Sonstige Einmalkosten<input id="finOnce" type="number" step="1000" value="${inputs.oneTime}" title="z. B. Spielerkauf"></label>
    </div>
    <div class="controls" style="margin-top:10px">
      <label>Zuschauer pro Woche<input id="finSpect" type="number" step="1000" min="0" value="${Math.round(inputs.spectators ?? n.spectators)}" title="Schnitt der bekannten Wochen; Heimspiele gibt es meist jede zweite Woche"></label>
      <label>Mindest-Puffer<input id="finBuffer" type="number" step="10000" min="0" value="${inputs.buffer}"></label>
    </div>
    <div id="finVerdict"></div>
    <div class="chart" id="finChart"></div>
  </div>

  <h3>Personal</h3>
  <div class="scroll"><table class="nowrap fin-staff">
    <thead><tr><th>Rolle</th><th>Name</th><th class="num">Stufe</th><th class="num">Kosten/Woche</th><th class="num">pro Saison</th><th>Im Plan</th></tr></thead>
    <tbody>${s.staff
      .map(
        (m) => `<tr><td>${esc(m.typeName)}</td><td>${esc(m.name || "–")}</td><td class="num">${m.level}</td><td class="num">${eur(m.weeklyCost)}</td><td class="num">${eur(m.weeklyCost * DEFAULT_HORIZON)}</td>
        <td>${m.isTrainer ? `<span class="muted">siehe Trainer</span>` : `<label class="check"><input type="checkbox" data-fire="${m.id}"${inputs.fired.has(m.id) ? " checked" : ""}> entlassen</label>`}</td></tr>`,
      )
      .join("")}</tbody>
    <tfoot><tr><th colspan="3">Summe</th><th class="num">${eur(staffSum)}</th><th class="num">${eur(staffSum * DEFAULT_HORIZON)}</th><th></th></tr></tfoot>
  </table></div>
  ${s.staff.length ? "" : `<p class="sub">Diese HRF-Datei enthält keinen [staff]-Abschnitt.</p>`}

  <h3>Wochenbilanz</h3>
  ${balanceTable(s, n)}

  ${historyTable()}

  <details><summary>Wann wird es gefährlich?</summary>
    <p class="sub">Laut Hattrick-Regeln kann man auch bei 0 weiter Geld ausgeben, zahlt im Minus aber hohe Zinsen.
    Ab ${RULES.spendingLimitUsd.toLocaleString("de-DE")} US$ Schulden sind Ausgaben eingeschränkt, ab ${RULES.bankruptcyWarningUsd.toLocaleString("de-DE")} US$ Schulden gibt es die Bankrottwarnung,
    und wer dann nicht binnen ${RULES.bankruptcyGraceWeeks} Wochen wieder darüber liegt, fliegt aus dem Ligasystem.
    TopHatt zieht die rote Linie deshalb schon bei 0 € und warnt gelb, wenn der Stand unter den Mindest-Puffer fällt.
    Die Prognose rechnet mit den laufenden Kosten dieser Woche, den aktuellen Sponsoren und dem Zuschauerschnitt; Transfers, Prämien und Pokalspiele sind nicht eingeplant.
    Wer Spezialisten entlässt, zahlt laut Regeln eine Abfindung (unter „Sonstiges“); deren Höhe kennt TopHatt nicht.</p>
  </details>`;
}

function balanceTable(s: FinanceSnapshot, n: NormalWeek): string {
  type Row = [string, (b: WeekBalance) => number, number | null];
  const inc: Row[] = [
    ["Zuschauer", (b) => b.income.spectators, n.spectators],
    ["Sponsoren", (b) => b.income.sponsors + b.income.sponsorsBonus, n.sponsors],
    ["Verkäufe & Sonstiges", (b) => b.income.other, null],
  ];
  const cost: Row[] = [
    ["Spielergehälter", (b) => b.costs.players, s.thisWeek.costs.players],
    ["Personal (Trainer & Spezialisten)", (b) => b.costs.staff, s.thisWeek.costs.staff],
    ["Stadion", (b) => b.costs.arena, s.thisWeek.costs.arena],
    ["Jugend", (b) => b.costs.youth, s.thisWeek.costs.youth],
    ["Käufe & Sonstiges", (b) => b.costs.other, null],
  ];
  const row = (r: Row, neg: boolean) =>
    `<tr><td>${r[0]}</td><td class="num">${eur(r[1](s.thisWeek) * (neg ? -1 : 1))}</td><td class="num">${eur(r[1](s.lastWeek) * (neg ? -1 : 1))}</td><td class="num">${r[2] === null ? "–" : eur(r[2] * (neg ? -1 : 1))}</td></tr>`;
  return `<div class="scroll"><table class="nowrap fin-bal">
    <thead><tr><th></th><th class="num">Diese Woche (bisher)</th><th class="num">Letzte Woche</th><th class="num">Typische Woche</th></tr></thead>
    <tbody>
      <tr class="grp"><th colspan="4">Einnahmen</th></tr>${inc.map((r) => row(r, false)).join("")}
      <tr class="grp"><th colspan="4">Ausgaben</th></tr>${cost.map((r) => row(r, true)).join("")}
    </tbody>
    <tfoot><tr><th>Saldo</th><th class="num ${s.thisWeek.total < 0 ? "neg" : "pos"}">${signed(s.thisWeek.total)}</th><th class="num ${s.lastWeek.total < 0 ? "neg" : "pos"}">${signed(s.lastWeek.total)}</th><th class="num ${n.total < 0 ? "neg" : "pos"}">${signed(n.total)}</th></tr></tfoot>
  </table></div>
  <p class="sub">„Diese Woche“ zählt bis zum nächsten Update (${fmtDay(s.economyDate)}); Zuschauer kommen erst nach einem Heimspiel dazu. Die typische Woche nimmt die laufenden Kosten von jetzt.</p>`;
}

function historyTable(): string {
  const h = data!.history;
  if (h.length < 2) return `<p class="sub">Je mehr HRF-Dateien im Ordner liegen (eine pro Woche reicht), desto genauer wird der Zuschauerschnitt und der Wochenverlauf.</p>`;
  return `<details><summary>Abgeschlossene Wochen (${h.length})</summary><div class="scroll"><table class="nowrap">
    <thead><tr><th>Abgerechnet</th><th class="num">Zuschauer</th><th class="num">Einnahmen</th><th class="num">Ausgaben</th><th class="num">davon Personal</th><th class="num">Saldo</th></tr></thead>
    <tbody>${[...h]
      .reverse()
      .map(
        (w) =>
          `<tr><td>${fmtDay(w.week)}</td><td class="num">${eur(w.balance.income.spectators)}</td><td class="num">${eur(w.balance.income.sum)}</td><td class="num">${eur(w.balance.costs.sum)}</td><td class="num">${eur(w.balance.costs.staff)}</td><td class="num ${w.balance.total < 0 ? "neg" : "pos"}">${signed(w.balance.total)}</td></tr>`,
      )
      .join("")}</tbody></table></div></details>`;
}

function wire(el: HTMLElement) {
  const num = (id: string) => {
    const v = Number((el.querySelector<HTMLInputElement>(`#${id}`)!).value);
    return Number.isFinite(v) ? v : 0;
  };
  el.querySelector("#finTrainer")!.addEventListener("change", (e) => {
    inputs.trainerLevel = Number((e.target as HTMLSelectElement).value);
    inputs.trainerPrice = inputs.trainerLevel ? TRAINER_PRICE_EXTERNAL[inputs.trainerLevel - 1] : 0;
    el.querySelector<HTMLInputElement>("#finTrainerPrice")!.value = String(inputs.trainerPrice);
    update();
  });
  el.querySelector(".fin-plan")!.addEventListener("input", (e) => {
    const id = (e.target as HTMLElement).id;
    if (id === "finTrainerPrice") inputs.trainerPrice = num(id);
    if (id === "finExtra") inputs.extraWeekly = num(id);
    if (id === "finOnce") inputs.oneTime = num(id);
    if (id === "finBuffer") inputs.buffer = Math.max(0, num(id));
    if (id === "finSpect") {
      const v = num(id);
      inputs.spectators = Math.round(v) === Math.round(baseNormal().spectators) ? null : v;
    }
    update();
  });
  el.querySelectorAll<HTMLInputElement>("[data-fire]").forEach((c) =>
    c.addEventListener("change", () => {
      const id = Number(c.dataset.fire);
      if (c.checked) inputs.fired.add(id);
      else inputs.fired.delete(id);
      update();
    }),
  );
  if (inputs.trainerLevel) el.querySelector<HTMLSelectElement>("#finTrainer")!.value = String(inputs.trainerLevel);
}

const VERDICT = {
  ok: { cls: "good", icon: "✓", word: "Tragbar" },
  knapp: { cls: "warning", icon: "!", word: "Knapp" },
  gefahr: { cls: "critical", icon: "✕", word: "Gefahr" },
} as const;

function update() {
  if (!root || !data) return;
  const s = data.snap;
  const n = currentNormal();
  const p = plan();
  const a = checkAffordability(s, p, { normal: n, buffer: inputs.buffer });
  const changed = p.extraWeeklyCost !== 0 || p.oneTimeCost !== 0;
  const v = VERDICT[a.verdict];
  const room = a.maxExtraWeekly + p.extraWeeklyCost; // Spielraum ohne den Plan
  root.querySelector("#finVerdict")!.innerHTML = `
    <div class="fin-verdict ${v.cls}">
      <span class="status ${v.cls}"><i>${v.icon}</i>${v.word}</span>
      <div>${changed ? "Mit diesem Plan: " : "Ohne Änderungen: "}${a.text.replace(/^Tragbar: /, "")}</div>
      <div class="sub">${
        changed
          ? `Plan: ${signed(-p.extraWeeklyCost).replace(/^\+/, "+")} pro Woche${p.oneTimeCost ? `, einmalig ${eur(p.oneTimeCost)}` : ""} · neuer Wochensaldo ${signed(n.total - p.extraWeeklyCost)}. `
          : ""
      }${
        a.maxExtraWeekly >= 0
          ? `Darüber hinaus wären noch bis zu <b>${eur(a.maxExtraWeekly)} pro Woche</b> drin, ohne unter den Puffer zu fallen.`
          : a.affordableInWeeks !== null
            ? `Mit typischen Wochen ist der Plan in <b>${a.affordableInWeeks} Woche${a.affordableInWeeks === 1 ? "" : "n"}</b> bezahlbar, ohne unter den Puffer zu fallen.`
            : `Auch mit Ansparen geht der Plan dauerhaft unter den Puffer: die Wochenkosten müssten sinken.`
      }${changed && room > 0 ? ` Ohne Plan läge der Spielraum bei ${eur(room)} pro Woche.` : ""}</div>
    </div>`;
  drawChart(s, n, p, a.forecast);
}

function drawChart(s: FinanceSnapshot, n: NormalWeek, p: ReturnType<typeof plan>, planFc: number[]) {
  const base = forecast(s, n, { extraWeeklyCost: 0, oneTimeCost: 0 });
  const changed = p.extraWeeklyCost !== 0 || p.oneTimeCost !== 0;
  const series = changed ? [base, planFc] : [base];
  const all = [s.cash, ...series.flat(), 0, inputs.buffer];
  let yMin = Math.min(...all);
  let yMax = Math.max(...all);
  const pad = (yMax - yMin) * 0.08 || 10000;
  yMin -= pad;
  yMax += pad;
  const narrow = window.innerWidth < 600;
  const W = narrow ? 420 : 1100,
    H = narrow ? 240 : 300,
    ml = narrow ? 52 : 78,
    mr = 16,
    mt = 12,
    mb = 30;
  const weeks = base.length;
  const X = (i: number) => ml + (i / weeks) * (W - ml - mr); // i = -1 … heute
  const Y = (v: number) => mt + (1 - (v - yMin) / (yMax - yMin)) * (H - mt - mb);
  const step = niceStep((yMax - yMin) / 5);
  let grid = "";
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step)
    grid += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${short(v)}</text>`;
  let ticks = "";
  for (let i = 0; i <= weeks; i += narrow ? 8 : 4)
    ticks += `<text x="${X(i)}" y="${H - mb + 18}" text-anchor="${i === 0 ? "start" : i >= weeks ? "end" : "middle"}" font-size="11" fill="var(--muted)">${i === 0 ? "heute" : `+${i} Wo.`}</text>`;
  const path = (fc: number[]) => [`M${X(0)},${Y(s.cash)}`, ...fc.map((c, i) => `L${X(i + 1).toFixed(1)},${Y(c).toFixed(1)}`)].join("");
  const zero = `<line x1="${ml}" x2="${W - mr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--critical)" stroke-width="1.5"/><text x="${W - mr}" y="${Y(0) + 14}" text-anchor="end" font-size="11" fill="var(--critical)">unter 0 €: Schulden</text>`;
  const buf = inputs.buffer
    ? `<line x1="${ml}" x2="${W - mr}" y1="${Y(inputs.buffer)}" y2="${Y(inputs.buffer)}" stroke="var(--warning)" stroke-dasharray="5 4"/><text x="${W - mr}" y="${Y(inputs.buffer) - 5}" text-anchor="end" font-size="11" fill="var(--warning-ink)">Puffer</text>`
    : "";
  const lines = series
    .map((fc, k) => {
      const col = k === 0 && changed ? "var(--muted)" : "var(--s1)";
      const end = fc[fc.length - 1];
      return `<path d="${path(fc)}" fill="none" stroke="${col}" stroke-width="2.2" ${k === 0 && changed ? 'stroke-dasharray="6 4"' : ""}/>
        <circle cx="${X(weeks)}" cy="${Y(end)}" r="3.5" fill="${col}"/>`;
    })
    .join("");
  const host = root!.querySelector<HTMLElement>("#finChart")!;
  host.innerHTML = `
    <div class="legend">${changed ? `<span><i class="dash"></i>ohne Änderung</span><span><i style="background:var(--s1)"></i>mit Plan</span>` : `<span><i style="background:var(--s1)"></i>Kontostand-Prognose</span>`}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kontostand-Prognose über ${weeks} Wochen">${grid}${ticks}${buf}${zero}${lines}
      <line class="cross" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--ink-2)" visibility="hidden"/>
      <rect class="hit" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent"/></svg>
    <div class="tip" hidden></div>`;
  const svg = host.querySelector("svg")!;
  const tip = host.querySelector<HTMLElement>(".tip")!;
  const cross = svg.querySelector(".cross")!;
  const hit = svg.querySelector(".hit")!;
  hit.addEventListener("mousemove", (ev) => {
    const e = ev as MouseEvent;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(weeks, Math.round(((x - ml) / (W - ml - mr)) * weeks)));
    cross.setAttribute("x1", String(X(i)));
    cross.setAttribute("x2", String(X(i)));
    cross.setAttribute("visibility", "visible");
    const val = (fc: number[]) => (i === 0 ? s.cash : fc[i - 1]);
    tip.hidden = false;
    tip.innerHTML = `<b>${i === 0 ? "heute" : `nach ${i} Woche${i === 1 ? "" : "n"}`}</b><br>${
      changed ? `ohne Änderung: ${eur(val(base))}<br><span style="color:var(--s1)">●</span> mit Plan: ${eur(val(planFc))}` : eur(val(base))
    }`;
    tip.style.left = `${Math.min(r.width - 190, Math.max(0, (X(i) / W) * r.width + 12))}px`;
    tip.style.top = "8px";
  });
  hit.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  });
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

function short(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Mio`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3).toLocaleString("de-DE")} T`;
  return `${sign}${Math.round(a)}`;
}
