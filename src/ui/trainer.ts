// Seite „Trainer & Effizienz“: Ist-Stand wie die Hattrick-Trainingseffizienz, Sandbox mit Kosten,
// günstigste Wege zu mehr Effizienz und Trainerpreise. Rechenlogik in core/staff.ts.
import {
  type PlanOption,
  type StaffPlan,
  type StaffSnapshot,
  TRAINER_SPEED,
  assistantLabel,
  currentAssistants,
  currentPlan,
  efficiencyFrontier,
  evaluatePlan,
  externalTrainerPrice,
  internalTrainerPrice,
  levelName,
  planOptions,
  staffFromHrf,
  staffWeeklyCost,
  trainerWeekly,
  weeksInClub,
} from "../core/staff";
import { TRAININGS } from "../core/training";

const STORE = "tophatt.trainerPlan";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const euro = (v: number) => `${Math.round(v).toLocaleString("de-DE")} €`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number, unit = "") => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("de-DE")}${unit}`;

interface Saved {
  plan: StaffPlan;
  horizon: number;
  leadership: number;
  reserve: number;
}

let snap: StaffSnapshot | null = null;
let saved: Saved | null = null;
let root: HTMLElement | null = null;

function load(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}
function store() {
  try {
    if (saved) localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    /* privat: ohne Speichern weiter */
  }
}

/** Neue HRF: Ist-Stand neu lesen; gespeicherte Sandbox bleibt, solange sie zum Verein passt */
export function renderTrainerPage(el: HTMLElement, hrfRaw: string) {
  root = el;
  snap = staffFromHrf(hrfRaw);
  const s = load();
  const now = currentPlan(snap);
  saved = {
    plan: s.plan && Array.isArray(s.plan.assistants) ? s.plan : now,
    horizon: s.horizon ?? 16,
    leadership: s.leadership ?? 6,
    reserve: s.reserve ?? 100000,
  };
  draw();
}

function cur() {
  return { assistants: currentAssistants(snap!), trainer: snap!.trainer };
}

function bar(label: string, right: string, value: number, max: number, text: string, opts: { marker?: number; cls?: string } = {}) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  const m = opts.marker != null ? `<i class="tb-mark" style="left:${(opts.marker / max) * 100}%" title="jetzt"></i>` : "";
  return `<div class="tb ${opts.cls ?? ""}"><div class="tb-head"><span>${label}</span><span>${right}</span></div>
    <div class="tb-track"><div class="tb-fill" style="width:${w}%"><span>${text}</span></div>${m}</div></div>`;
}

/** Balken Fertigkeit | verlorene Effizienz (schraffiert) | Kondition, wie in Hattrick */
function effBar(eff: number, staminaShare: number, label: string, marker?: number) {
  const skillShare = 100 - staminaShare;
  const e = eff * 100;
  const m = marker != null ? `<i class="tb-mark" style="left:${marker * 100}%" title="jetzt ${pct(marker)}"></i>` : "";
  return `<div class="tb eff"><div class="tb-head"><span>${label}</span><span>Kondition</span></div>
    <div class="tb-track"><div class="tb-fill" style="width:${e}%"><span>${Math.round(e)} %</span></div><div class="tb-lost" style="width:${Math.max(0, skillShare - e)}%"></div><div class="tb-stam" style="width:${staminaShare}%"><span>${staminaShare} %</span></div>${m}</div></div>`;
}

function trainingName() {
  return TRAININGS[snap!.trainingType]?.name ?? "Training";
}

function settingBars(p: StaffPlan, base?: StaffPlan) {
  const tl = p.trainerSource === "keep" ? snap!.trainer?.level || p.trainerLevel : p.trainerLevel;
  const bl = base && (base.trainerSource === "keep" ? snap!.trainer?.level || base.trainerLevel : base.trainerLevel);
  const a = p.assistants[0] + p.assistants[1];
  return [
    bar(trainingName(), "Kondition", 100 - p.staminaShare, 100, `${100 - p.staminaShare} % | ${p.staminaShare} %`, { marker: base ? 100 - base.staminaShare : undefined }),
    bar("Trainingsintensität", "", p.intensity, 100, `${p.intensity} %`, { marker: base?.intensity }),
    bar("Trainerfähigkeit", `${Math.round(TRAINER_SPEED[tl - 1] * 100)} % Tempo`, tl, 5, String(tl), { marker: bl }),
    bar("Assistenzstufen", assistantLabel(p.assistants), a, 10, String(a), { marker: base ? base.assistants[0] + base.assistants[1] : undefined }),
  ].join("");
}

function verdict(cash: number | null, oneTime: number, reserve: number) {
  if (cash == null) return `<span class="sub">Kontostand unbekannt</span>`;
  const after = cash - oneTime;
  const cls = after < 0 ? "critical" : after < reserve ? "warning" : "good";
  const sym = after < 0 ? "!" : after < reserve ? "!" : "✓";
  const word = after < 0 ? "nicht bezahlbar" : after < reserve ? "unter deiner Reserve" : "bezahlbar";
  return `<span class="status ${cls}"><i>${sym}</i>${word}</span> <span class="sub">Kontostand ${euro(cash)} → ${euro(after)}</span>`;
}

function draw() {
  if (!root || !snap || !saved) return;
  const s = snap;
  const now = currentPlan(s);
  const base = evaluatePlan(now, cur(), saved.horizon);
  const sb = evaluatePlan(saved.plan, cur(), saved.horizon);
  const others = s.members.filter((m) => !m.isTrainer && m.type !== 1).reduce((x, m) => x + m.weeklyCost, 0);

  // --- Ist-Stand und Personal
  const staffRows = s.members.length
    ? s.members
        .map(
          (m) => `<tr><td>${esc(m.typeName)}</td><td>${esc(m.isTrainer ? s.trainer?.name ?? "" : m.name)}</td><td class="num">${m.level}</td>
          <td class="num">${euro(m.weeklyCost)}</td><td class="num">${m.contractWeeks ? `${m.contractWeeks} Wo.` : m.isTrainer ? "–" : "?"}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="sub">Die HRF enthält keinen [staff]-Abschnitt (ältere HO-Version). Assistenzstufen laut Verein: ${s.assistantLevels}.</td></tr>`;
  const staffTotal = s.members.reduce((x, m) => x + m.weeklyCost, 0);

  // --- Sandbox
  const p = saved.plan;
  const srcBtn = (v: StaffPlan["trainerSource"], t: string) => `<button class="${p.trainerSource === v ? "on" : ""}" data-src="${v}">${t}</button>`;
  const cand = s.candidates;
  const chosen = cand.find((c) => c.id === p.candidateId) ?? cand[0];
  const levelOpts = (max: number) =>
    [1, 2, 3, 4, 5].map((l) => `<option value="${l}" ${l === p.trainerLevel ? "selected" : ""} ${l > max ? "disabled" : ""}>Stufe ${l} (${Math.round(TRAINER_SPEED[l - 1] * 100)} %)</option>`).join("");
  const leadOpts = (sel: number) => [3, 4, 5, 6, 7].map((l) => `<option value="${l}" ${l === sel ? "selected" : ""}>${levelName(l)} (${l})</option>`).join("");
  let trainerCtl = "";
  if (p.trainerSource === "external") {
    trainerCtl = `<label>Stufe<select data-k="trainerLevel">${levelOpts(5)}</select></label>
      <label>Führungsqualität<select data-k="leadership">${leadOpts(p.leadership)}</select></label>`;
  } else if (p.trainerSource === "internal") {
    trainerCtl = cand.length
      ? `<label>Spieler<select data-k="candidateId">${cand
          .map((c) => `<option value="${c.id}" ${c.id === chosen?.id ? "selected" : ""}>${esc(c.name)} · Erfahrung ${levelName(c.experience)} (${c.experience}) · bis Stufe ${c.maxLevel}</option>`)
          .join("")}</select></label>
        <label>Stufe<select data-k="trainerLevel">${levelOpts(chosen?.maxLevel ?? 0)}</select></label>`
      : `<span class="sub">Kein Spieler mit genug Erfahrung (mindestens schwach) im Kader.</span>`;
  }
  if (p.trainerSource !== "keep")
    trainerCtl += `<label>Preis laut Hattrick<input type="number" min="0" step="100" data-k="priceOverride" placeholder="${p.trainerSource === "internal" ? "geschätzt" : "aus Tabelle"}" value="${p.priceOverride || ""}" style="width:130px"></label>`;
  const internalNote = (() => {
    if (p.trainerSource !== "internal" || !chosen) return "";
    const w = weeksInClub(chosen.arrival, new Date());
    const wait = w != null && w < 16 ? ` Laut Regelwerk muss ein Spieler 16 Wochen im Verein sein, ${esc(chosen.name)} ist es seit ${w} Wochen. Prüfe, ob Hattrick ihn unter „Trainer wechseln“ anbietet.` : "";
    return `<p class="sub">Preis geschätzt aus deiner Hattrick-Seite (Erfahrung passabel: Stufe 3 für 277 700 €, je mehr Erfahrung desto teurer); den genauen Preis zeigt Hattrick unter „Trainer wechseln“, trag ihn oben ein. ${esc(chosen.name)} fällt danach als Spieler weg und behält seine Führungsqualität ${levelName(chosen.leadership)}.${wait}</p>`;
  })();
  const range = (k: string, label: string, v: number, min: number, max: number, step = 1, unit = "") =>
    `<label class="tr-range">${label} <b>${v}${unit}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  const effGain = (sb.efficiency - base.efficiency) * 100;
  const faster = base.efficiency > 0 ? sb.efficiency / base.efficiency - 1 : 0;
  const weeksMore = saved.horizon * faster;
  const extra = sb.weeklyEquivalent - base.weeklyEquivalent;
  const kpi = (label: string, value: string, sub = "") => `<div class="tr-kpi"><div class="sub">${label}</div><div class="v">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

  // --- Beste Wege
  const { options } = planOptions({ snapshot: s, horizonWeeks: saved.horizon, leadership: saved.leadership, contractWeeks: 16, reserve: saved.reserve, now: new Date() });
  const frontier = efficiencyFrontier(options.filter((o) => o.affordable)).filter((o) => o.gain > 0.05);
  const blocked = efficiencyFrontier(options).filter((o) => !o.affordable && o.gain > 0.05);
  const best = frontier.length ? frontier.reduce((a, b) => ((b.costPerPoint ?? Infinity) < (a.costPerPoint ?? Infinity) ? b : a)) : null;
  const optRow = (o: PlanOption, i: number, cls = "") => `<tr class="${cls}">
      <td class="num"><b>${pct(o.result.efficiency)}</b><div class="sub">${signed(o.gain, " Pkt.")}</div></td>
      <td>${esc(o.label)}${o === best ? ` <span class="status good"><i>✓</i>bestes Verhältnis</span>` : ""}</td>
      <td class="num">${signed(o.result.weekly - base.weekly, " €")}</td>
      <td class="num">${o.result.oneTime ? euro(o.result.oneTime) : "–"}</td>
      <td class="num">${o.costPerPoint != null ? euro(o.costPerPoint) : "–"}</td>
      <td><button class="btn" data-try="${cls}${i}">Ausprobieren</button></td></tr>`;

  // --- Preise
  const priceRows = [1, 2, 3, 4, 5]
    .map((l) => {
      const intern = cand
        .map((c) => ({ c, price: internalTrainerPrice(l, c.experience) }))
        .filter((x) => x.price != null)
        .sort((a, b) => a.price! - b.price!)[0];
      return `<tr class="${l === (s.trainer?.level ?? 0) ? "me" : ""}"><td>Stufe ${l}</td><td class="num">${Math.round(TRAINER_SPEED[l - 1] * 100)} %</td><td class="num">${euro(trainerWeekly(l))}</td>
        <td class="num">${euro(externalTrainerPrice(l, saved!.leadership))}</td>
        <td>${intern ? `${euro(intern.price!)} <span class="sub">${esc(intern.c.name)} (geschätzt)</span>` : `<span class="sub">kein Spieler mit genug Erfahrung</span>`}</td></tr>`;
    })
    .join("");
  const asstRows = [1, 2, 3, 4, 5]
    .map((l) => `<tr><td>Stufe ${l}</td><td class="num">+${(l * 3.5).toLocaleString("de-DE")} %</td><td class="num">${euro(staffWeeklyCost(l, 16))}</td><td class="num">${euro(staffWeeklyCost(l, 8))}</td><td class="num">${euro(staffWeeklyCost(l, 1))}</td></tr>`)
    .join("");

  root.innerHTML = `
  <div class="grid2">
    <div>
      <h3 style="margin-top:0">So trainierst du jetzt</h3>
      <div class="tr-bars">${settingBars(now)}${effBar(base.efficiency, now.staminaShare, `Gesamteffizienz ${trainingName()}`)}</div>
      <p class="sub">Gesamteffizienz wie in Hattrick: 100 % wären Trainer 5, zehn Assistenzstufen, Intensität 100 % und kein Konditionsanteil.</p>
    </div>
    <div>
      <h3 style="margin-top:0">Personal und Kosten pro Woche</h3>
      <div class="scroll"><table class="nowrap"><thead><tr><th>Rolle</th><th>Name</th><th class="num">Stufe</th><th class="num">Kosten/Woche</th><th class="num">Vertrag</th></tr></thead>
      <tbody>${staffRows}</tbody>${staffTotal ? `<tfoot><tr><th colspan="3">Gesamt</th><th class="num">${euro(staffTotal)}</th><th></th></tr></tfoot>` : ""}</table></div>
      <p class="sub">Vertragslänge aus Stufe und Kosten zurückgerechnet (längere Verträge sind pro Woche billiger). Kontostand: ${s.cash != null ? euro(s.cash) : "unbekannt"}.</p>
    </div>
  </div>

  <h3>Sandbox: was wäre wenn?</h3>
  <div class="tr-sandbox">
    <div class="tr-ctl">
      <div class="controls"><div><div class="sub">Trainer</div><div class="seg">${srcBtn("keep", "Behalten")}${srcBtn("external", "Extern holen")}${srcBtn("internal", "Eigener Spieler")}</div></div>${trainerCtl}</div>
      ${internalNote}
      <div class="tr-ranges">
        ${range("a0", "Assistent 1, Stufe", p.assistants[0], 0, 5)}
        ${range("a1", "Assistent 2, Stufe", p.assistants[1], 0, 5)}
        ${range("contractWeeks", "Vertrag neuer Assistenten", p.contractWeeks, 1, 16, 1, " Wo.")}
        ${range("intensity", "Trainingsintensität", p.intensity, 0, 100, 1, " %")}
        ${range("staminaShare", "Konditionsanteil", p.staminaShare, 10, 50, 1, " %")}
      </div>
      <p><button class="btn" id="trReset">Auf aktuellen Stand zurücksetzen</button></p>
    </div>
    <div class="tr-out">
      <div class="tr-bars">${settingBars(p, now)}${effBar(sb.efficiency, p.staminaShare, "Gesamteffizienz", base.efficiency)}</div>
      <div class="tr-kpis">
        ${kpi("Effizienz", `${pct(sb.efficiency)} <small>${signed(effGain, " Pkt.")}</small>`, `Training ${signed(faster * 100, " %")} ${faster >= 0 ? "schneller" : "langsamer"}`)}
        ${kpi(`Gewinn in ${saved.horizon} Wochen`, `${signed(weeksMore)} Wo.`, "zusätzliche volle Trainingswochen")}
        ${kpi("Trainer + Assistenten", `${euro(sb.weekly)} <small>${signed(sb.weekly - base.weekly, " €")}</small>`, `pro Woche; mit anderen Spezialisten ${euro(sb.weekly + others)}`)}
        ${kpi("Einmalkosten", sb.oneTime ? euro(sb.oneTime) : "keine", sb.oneTime ? `verteilt auf ${saved.horizon} Wochen: ${euro(sb.oneTime / saved.horizon)} pro Woche` : "")}
        ${kpi("Kosten je Effizienzpunkt", effGain > 0.05 ? euro(extra / effGain) : "–", "pro Woche, inkl. verteilter Einmalkosten")}
      </div>
      <p>${verdict(s.cash, sb.oneTime, saved.reserve)}</p>
      ${p.staminaShare < 15 ? `<p class="sub">Unter 15 % Kondition sinkt die Kondition der Spieler mit der Zeit. Hattrick erlaubt mindestens 10 %.</p>` : ""}
      ${p.intensity < 100 ? `<p class="sub">Weniger Intensität senkt das Training im gleichen Verhältnis, dafür sinkt das Verletzungsrisiko etwas.</p>` : ""}
    </div>
  </div>

  <h3>Günstigste Wege zu mehr Effizienz</h3>
  <div class="controls">
    <label>Zeitraum<select data-g="horizon">${[8, 16, 32, 48].map((h) => `<option value="${h}" ${h === saved!.horizon ? "selected" : ""}>${h} Wochen${h === 16 ? " (1 Saison)" : h === 32 ? " (2 Saisons)" : ""}</option>`).join("")}</select></label>
    <label>Führung externer Trainer<select data-g="leadership">${leadOpts(saved.leadership)}</select></label>
    <label>Reserve auf dem Konto<select data-g="reserve">${[0, 100000, 250000, 500000].map((r) => `<option value="${r}" ${r === saved!.reserve ? "selected" : ""}>${euro(r)}</option>`).join("")}</select></label>
  </div>
  <p class="sub">Jede Zeile bringt mehr Effizienz als alle billigeren. Einmalpreise werden über den Zeitraum verteilt; neue Assistenten mit 16-Wochen-Vertrag, Intensität und Kondition wie jetzt. Kosten je Punkt = Mehrkosten pro Woche geteilt durch gewonnene Effizienzpunkte.</p>
  <div class="scroll"><table class="tr-opts"><thead><tr><th class="num">Effizienz</th><th>Plan</th><th class="num">Wochenkosten</th><th class="num">Einmalig</th><th class="num">€ je Punkt</th><th></th></tr></thead>
    <tbody>${frontier.length ? frontier.map((o, i) => optRow(o, i)).join("") : `<tr><td colspan="6" class="sub">Mit dieser Reserve gibt es keinen bezahlbaren Schritt nach oben.</td></tr>`}</tbody></table></div>
  ${
    blocked.length
      ? `<details class="more"><summary>Nicht bezahlbar mit ${euro(saved.reserve)} Reserve (${blocked.length})</summary><div class="scroll"><table class="tr-opts"><tbody>${blocked.slice(0, 8).map((o, i) => optRow(o, i, "x")).join("")}</tbody></table></div></details>`
      : ""
  }

  <h3>Preise</h3>
  <div class="grid2">
    <div class="scroll"><table><thead><tr><th>Trainer</th><th class="num">Tempo</th><th class="num">Gehalt/Woche</th><th class="num">Extern (Führung ${levelName(saved.leadership)})</th><th>Eigener Spieler</th></tr></thead><tbody>${priceRows}</tbody></table>
    <p class="sub">Erfahrung bestimmt die höchste Stufe eines eigenen Spielers (passabel → 3, gut → 4, sehr gut → 5). Der alte Trainer verlässt den Verein. Führungsqualität wirkt auf die Teamstimmung, nicht aufs Training.</p></div>
    <div class="scroll"><table class="nowrap"><thead><tr><th>Assistent</th><th class="num">Training</th><th class="num">16 Wo.</th><th class="num">8 Wo.</th><th class="num">1 Wo.</th></tr></thead><tbody>${asstRows}</tbody></table>
    <p class="sub">Höchstens zwei Assistenten, zusammen 10 Stufen. Je Stufe +2,5 % Verletzungsrisiko und +0,05 Form. Wer einen Vertrag vorzeitig kündigt, zahlt das Doppelte der bisher gesparten Kosten.</p></div>
  </div>`;

  // Optionen für „Ausprobieren“ merken
  (root as HTMLElement & { _opts?: Record<string, PlanOption> })._opts = Object.fromEntries([...frontier.map((o, i) => [String(i), o]), ...blocked.slice(0, 8).map((o, i) => [`x${i}`, o])]);
}

export function initTrainerPage(el: HTMLElement) {
  // Beim Ziehen nur die Zahl zeigen, beim Loslassen neu rechnen (Neuaufbau würde das Ziehen abbrechen)
  el.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.type !== "range") return;
    const b = t.parentElement?.querySelector("b");
    if (b) b.textContent = b.textContent!.replace(/^\d+/, t.value);
  });
  el.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (!saved || !snap) return;
    const v = Number(t.value);
    if ((t as unknown as HTMLInputElement).type === "range") {
      const k = t.dataset.k!;
      const p = { ...saved.plan, assistants: [...saved.plan.assistants] as [number, number] };
      if (k === "a0") p.assistants[0] = v;
      else if (k === "a1") p.assistants[1] = v;
      else (p as unknown as Record<string, number>)[k] = v;
      saved.plan = p;
      store();
      draw();
      el.querySelector<HTMLInputElement>(`input[data-k="${k}"]`)?.focus();
      return;
    }
    if (t.dataset.k === "priceOverride") {
      saved.plan = { ...saved.plan, priceOverride: v > 0 ? v : undefined };
      store();
      draw();
      return;
    }
    if (t.tagName !== "SELECT") return;
    if (t.dataset.g) (saved as unknown as Record<string, number>)[t.dataset.g] = v;
    else if (t.dataset.k === "candidateId") {
      const c = snap.candidates.find((c) => c.id === v);
      if (c) saved.plan = { ...saved.plan, priceOverride: undefined, candidateId: c.id, leadership: c.leadership, experience: c.experience, trainerLevel: Math.min(saved.plan.trainerLevel, c.maxLevel) };
    } else if (t.dataset.k) saved.plan = { ...saved.plan, priceOverride: undefined, [t.dataset.k]: v };
    store();
    draw();
  });
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-src],[data-try],#trReset");
    if (!b || !saved || !snap) return;
    if (b.id === "trReset") saved.plan = currentPlan(snap);
    else if (b.dataset.src) {
      const src = b.dataset.src as StaffPlan["trainerSource"];
      const p = { ...saved.plan, trainerSource: src, priceOverride: undefined };
      if (src === "keep") Object.assign(p, { trainerLevel: snap.trainer?.level || 3, leadership: snap.trainer?.leadership ?? 6 });
      const up = Math.min(5, (snap.trainer?.level || 3) + 1);
      if (src === "external") Object.assign(p, { leadership: saved.leadership, trainerLevel: up });
      if (src === "internal") {
        const c = snap.candidates[0];
        if (c) Object.assign(p, { candidateId: c.id, leadership: c.leadership, experience: c.experience, trainerLevel: Math.min(up, c.maxLevel) || 1 });
      }
      saved.plan = p;
    } else if (b.dataset.try) {
      const o = (el as HTMLElement & { _opts?: Record<string, PlanOption> })._opts?.[b.dataset.try];
      if (o) saved.plan = { ...o.plan };
    }
    store();
    draw();
    if (b.dataset.try) el.querySelector(".tr-sandbox")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
