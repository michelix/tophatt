// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Seite „Trainingsfortschritt“: was das Training seit Saisonbeginn gebracht hat. Rechenlogik in core/progress.ts.
import { DEV_SKILL_DE, type DevSkill, trainedSkill } from "../core/development";
import { type PlayerProgress, type ProgressSkill, SEASON_WEEKS, type SeasonProgress, type SkillChange } from "../core/progress";
import { TRAININGS } from "../core/training";
import { loc } from "../core/locale";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SKILL_DE: Record<ProgressSkill, string> = { ...DEV_SKILL_DE, stamina: "Kondition" };
const day = (d: Date) => d.toLocaleDateString(loc(), { day: "2-digit", month: "2-digit" });
const dayTime = (d: Date) => `${day(d)} ${d.toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" })}`;
const num = (v: number, digits = 1) => v.toLocaleString(loc(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

type Mode = "trained" | "all";
const MODE_KEY = "tophatt.progressMode";
let mode: Mode = "trained";
try {
  if (localStorage.getItem(MODE_KEY) === "all") mode = "all";
} catch {
  /* ohne Speicher */
}

export interface ProgressContext {
  tierBadge: (id: number) => string;
  avatar: (id: number) => string;
}

let last: { el: HTMLElement; data: SeasonProgress | null; why: string; ctx: ProgressContext } | null = null;

export function renderProgress(el: HTMLElement, data: SeasonProgress | null, why: string, ctx: ProgressContext) {
  last = { el, data, why, ctx };
  if (!data) {
    el.innerHTML = `<p class="sub">${esc(why)}</p>`;
    return;
  }
  const done = data.weeks.filter((w) => w.done);
  const lastDone = done[done.length - 1];
  const t = lastDone ? TRAININGS[lastDone.type] : undefined;
  const gap = done.some((w) => w.beforeHistory);
  const trainees = data.players.filter((p) => p.shares.some((s) => (s ?? 0) > 0));
  const full = trainees.filter((p) => p.shares.some((s) => s === 1)).length;
  const dropNames = data.players.filter((p) => p.changes.some((c) => c.skill === "stamina" && c.to < c.from)).map((p) => `${p.name} (${p.age})`);

  const kpis = `<div class="hkpis pg-kpis">
    <div class="hkpi"><span class="sub">Trainings diese Saison</span><b>${done.length} von ${SEASON_WEEKS}</b><span class="sub">${esc(t ? `${t.name} · ${lastDone.intensity} % · Kondition ${lastDone.staminaShare} %` : "Training unbekannt")}</span></div>
    <div class="hkpi"><span class="sub">Aufstiege im trainierten Skill</span><b>${data.trainedUps}</b><span class="sub">erwartet: ≈ ${num(data.expectedUps)}</span></div>
    <div class="hkpi"><span class="sub">Spieler im Training</span><b>${trainees.length}</b><span class="sub">davon ${full} mit vollem Training</span></div>
    <div class="hkpi"><span class="sub">Kondition</span><b>+${data.staminaUp} / −${data.staminaDown}</b><span class="sub">${esc(dropNames.length ? `Rückgang: ${dropNames.slice(0, 2).join(", ")}` : "kein Rückgang")}</span></div>
  </div>`;

  const strip = `<div class="pg-weeks">${data.weeks
    .map((w) => {
      const cls = w.done ? (w.beforeHistory ? "done gap" : "done") : "";
      const cur = w === lastDone ? " now" : "";
      const title = `${TRAININGS[w.type]?.name ?? "kein Training"} · ${w.intensity} %`;
      return `<div class="pg-wk ${cls}${cur}" title="${esc(title)}">W${w.index}<b>${day(w.date)}</b></div>`;
    })
    .join("")}</div>
    <p class="sub pg-note">${esc(trainingRuns(data))}</p>`;

  const gapNote = gap
    ? `<p class="sub pg-note">Startstand ist der erste HO-Download der Saison (${dayTime(data.startDate)}). Das Training vom ${day(done[0].date)} steckt darin schon, Aufstiege daraus sind nicht sichtbar.</p>`
    : `<p class="sub pg-note">Startstand: HO-Download vom ${dayTime(data.startDate)}.</p>`;

  el.innerHTML = `<p class="sub">Saison ${data.season} · seit dem ersten Training der Saison (${day(data.weeks[0].date)}) · Stand ${dayTime(data.nowDate)}</p>
    ${kpis}
    <h3 class="pg-h">Saisonverlauf <span class="sub">jede Kachel = ein Trainingsupdate</span></h3>${strip}
    <h3 class="pg-h">Spieler im Training</h3>
    <div class="seg pg-mode"><button data-pgmode="trained" class="${mode === "trained" ? "on" : ""}">Trainierter Skill</button><button data-pgmode="all" class="${mode === "all" ? "on" : ""}">Alle Veränderungen</button></div>
    ${mode === "trained" ? traineeTable(data, ctx) : allChanges(data, ctx)}
    ${gapNote}
    <div class="grid2 pg-bottom">
      <div><h3 class="pg-h">Andere Veränderungen seit Saisonstart</h3>${otherChanges(data)}</div>
      <div><h3 class="pg-h">Erwartet und tatsächlich <span class="sub">Aufstiege im trainierten Skill, alle Spieler</span></h3>${curveSvg(data)}
      <p class="sub pg-note">Liegt „tatsächlich“ über mehrere Wochen deutlich unter „erwartet“, stimmen Einsätze, Trainer oder Intensität nicht. Einzelne Wochen schwanken normal.</p></div>
    </div>`;
  el.querySelectorAll<HTMLButtonElement>("[data-pgmode]").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.pgmode === "all" ? "all" : "trained";
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        /* ohne Speicher */
      }
      if (last) renderProgress(last.el, last.data, last.why, last.ctx);
    }),
  );
}

/** "W1–W3: Spielaufbau · W4–W16: Spielaufbau (geplant)" */
function trainingRuns(data: SeasonProgress): string {
  const runs: { from: number; to: number; name: string; done: boolean }[] = [];
  for (const w of data.weeks) {
    const name = TRAININGS[w.type]?.name ?? "kein Training";
    const r = runs[runs.length - 1];
    if (r && r.name === name && r.done === w.done) r.to = w.index;
    else runs.push({ from: w.index, to: w.index, name, done: w.done });
  }
  return runs.map((r) => `${r.from === r.to ? `W${r.from}` : `W${r.from}–W${r.to}`}: ${r.name}${r.done ? "" : " (geplant)"}`).join(" · ");
}

function squares(p: PlayerProgress): string {
  return p.shares
    .map((s, i) => (s === null ? "" : `<i class="pg-sq ${s >= 1 ? "f" : s > 0 ? "h" : ""}" title="W${i + 1}: ${s >= 1 ? "volles Training" : s > 0 ? "halbes Training" : "kein Training"}"></i>`))
    .join("");
}

function nameCell(p: PlayerProgress, ctx: ProgressContext) {
  return `<td class="pg-name">${ctx.avatar(p.id)}${ctx.tierBadge(p.id)}<a href="#" class="pname-link" data-detail="${p.id}">${esc(p.name)}</a></td>`;
}

function levelCell(p: PlayerProgress, sk: ProgressSkill) {
  const a = p.start[sk];
  const b = p.now[sk];
  const arrow = b > a ? `<span class="pg-up">${b} ▲</span>` : b < a ? `<span class="pg-down">${b} ▼</span>` : `${b}`;
  return `<td class="num">${a} → ${arrow}</td>`;
}

function traineeTable(data: SeasonProgress, ctx: ProgressContext): string {
  const lastDone = [...data.weeks].reverse().find((w) => w.done && trainedSkill(w.type));
  const sk = (lastDone ? trainedSkill(lastDone.type) : null) as DevSkill | null;
  if (!sk) return `<p class="sub">In dieser Saison lief noch kein Fertigkeitstraining.</p>`;
  const rows = data.players.filter((p) => p.shares.some((s) => (s ?? 0) > 0) || p.changes.some((c) => c.skill === sk && c.to > c.from));
  const weight = (p: PlayerProgress) => p.shares.reduce<number>((a, s) => a + (s ?? 0), 0);
  rows.sort((a, z) => weight(z) - weight(a) || (z.progress ?? 0) - (a.progress ?? 0));
  const rest = data.players.length - rows.length;
  const body = rows
    .map((p) => {
      const up = p.changes.find((c) => c.skill === sk && c.to > c.from);
      const trained = p.shares.some((s) => (s ?? 0) > 0);
      let status: string;
      if (up && !trained) status = `<span class="pg-tag r">Aufstieg ohne Einsatz auf Trainingsposition, prüfen</span>`;
      else if (up && (p.progress ?? 0) < 0.15) status = `<span class="pg-tag g">Aufstieg ${day(up.date)}</span>`;
      else if (p.weeksToNext === null) status = `<span class="pg-tag n">–</span>`;
      else {
        const halfOnly = !p.shares.some((s) => s === 1);
        const txt = `in ≈ ${p.weeksToNext} ${p.weeksToNext === 1 ? "Woche" : "Wochen"}`;
        status = `<span class="pg-tag ${halfOnly ? "w" : p.weeksToNext <= 4 ? "g" : "n"}">${halfOnly ? `nur halbes Training: ${txt}` : txt}</span>`;
      }
      const prog = p.progress === null ? "" : up && p.progress < 0.05 ? `<span class="pg-bar"><i style="width:2%"></i></span><span class="pg-pct">neu</span>` : `<span class="pg-bar"><i style="width:${Math.round(p.progress * 100)}%"></i></span><span class="pg-pct">mind. ${Math.round(p.progress * 100)} %</span>`;
      return `<tr>${nameCell(p, ctx)}<td class="num">${p.age}</td><td class="pg-sqs">${squares(p)}</td>${levelCell(p, sk)}<td>${prog}</td><td>${status}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="nowrap pg-table"><thead><tr><th>Spieler</th><th class="num">Alter</th><th>Einsätze W1–W${data.weeks.filter((w) => w.done).length}</th>
    <th class="num">${esc(DEV_SKILL_DE[sk])}<br>Start → jetzt</th><th>Fortschritt im Level (geschätzt)</th><th>Nächster Aufstieg</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="sub pg-note"><span>Kästchen: ausgefüllt = volles Training, halb gefüllt = halbes Training, leer = kein Spiel auf einer Trainingsposition.</span> Fortschritt mit derselben Formel wie bei „Spielerentwicklung“, gezählt ab dem Startstand bzw. dem letzten Aufstieg. Die Spielminuten fehlen in den HO-Daten, jedes Spiel zählt deshalb wie 90 Minuten. ${rest > 0 ? `${rest} weitere Spieler ohne Training in dieser Saison.` : ""}</p>`;
}

function changeTag(c: SkillChange, p: PlayerProgress, data: SeasonProgress): string {
  if (c.skill === "stamina") return c.to > c.from ? `<span class="pg-tag g">Konditionstraining</span>` : `<span class="pg-tag r">Rückgang</span>`;
  if (c.to < c.from) return `<span class="pg-tag r">Altersabbau</span>`;
  const w = data.weeks[c.week - 1];
  return w && trainedSkill(w.type) === c.skill ? `<span class="pg-tag g">Training</span>` : `<span class="pg-tag n">nicht trainiert</span>`;
}

function otherChanges(data: SeasonProgress): string {
  const trained = new Set<string>(data.trainedSkills);
  const rows = data.players.flatMap((p) => p.changes.filter((c) => !trained.has(c.skill)).map((c) => ({ p, c })));
  if (!rows.length) return `<p class="sub">Keine.</p>`;
  rows.sort((a, z) => a.c.date.getTime() - z.c.date.getTime());
  return `<div class="scroll"><table class="pg-mini nowrap"><tbody>${rows
    .map(
      ({ p, c }) =>
        `<tr><td><a href="#" class="pname-link" data-detail="${p.id}">${esc(p.name)}</a> (${p.age})</td><td>${esc(SKILL_DE[c.skill])}</td><td class="num">${c.from} → <span class="${c.to > c.from ? "pg-up" : "pg-down"}">${c.to} ${c.to > c.from ? "▲" : "▼"}</span></td><td>${day(c.date)}</td><td>${changeTag(c, p, data)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function allChanges(data: SeasonProgress, ctx: ProgressContext): string {
  const rows = data.players.filter((p) => p.changes.length);
  if (!rows.length) return `<p class="sub">Seit Saisonstart hat sich keine Stufe verändert.</p>`;
  return `<div class="scroll"><table class="nowrap pg-table"><thead><tr><th>Spieler</th><th class="num">Alter</th><th>Einsätze</th><th>Veränderungen</th></tr></thead><tbody>${rows
    .map(
      (p) =>
        `<tr>${nameCell(p, ctx)}<td class="num">${p.age}</td><td class="pg-sqs">${squares(p)}</td><td>${p.changes
          .map((c) => `${esc(SKILL_DE[c.skill])} ${c.from} → <span class="${c.to > c.from ? "pg-up" : "pg-down"}">${c.to}</span> <span class="sub">(${day(c.date)})</span> ${changeTag(c, p, data)}`)
          .join("<br>")}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function curveSvg(data: SeasonProgress): string {
  const pts = data.curve;
  if (pts.length < 2) return `<p class="sub">Die Linie erscheint nach dem ersten Training mit HO-Stand davor und danach.</p>`;
  const W = 360,
    H = 160,
    L = 30,
    R = 12,
    T = 12,
    B = 26;
  const maxY = Math.max(1, Math.ceil(Math.max(...pts.map((p) => Math.max(p.expected, p.actual)))));
  const x0 = pts[0].week;
  const x1 = Math.max(pts[pts.length - 1].week, x0 + 1);
  const x = (w: number) => L + ((w - x0) / (x1 - x0)) * (W - L - R);
  const y = (v: number) => H - B - (v / maxY) * (H - T - B);
  const line = (k: "expected" | "actual") => pts.map((p) => `${x(p.week).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: maxY + 1 }, (_, i) => i).filter((i) => maxY <= 6 || i % Math.ceil(maxY / 6) === 0);
  return `<svg class="pg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Erwartet und tatsächlich">
    ${ticks.map((i) => `<line x1="${L}" x2="${W - R}" y1="${y(i)}" y2="${y(i)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(i) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${i}</text>`).join("")}
    ${pts.map((p) => `<text x="${x(p.week)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${p.week === x0 ? "Start" : `W${p.week}`}</text>`).join("")}
    <polyline points="${line("expected")}" fill="none" stroke="var(--s1)" stroke-width="2.5" stroke-dasharray="5 4"/>
    <polyline points="${line("actual")}" fill="none" stroke="var(--brand)" stroke-width="3"/>
    ${pts.map((p) => `<circle cx="${x(p.week)}" cy="${y(p.actual)}" r="3.5" fill="var(--brand)"><title>W${p.week}: ${p.actual} tatsächlich, ${num(p.expected)} erwartet</title></circle>`).join("")}
  </svg>
  <div class="pg-legend"><span><i class="pg-l a"></i>tatsächlich</span><span><i class="pg-l e"></i>erwartet (Formel)</span></div>`;
}
