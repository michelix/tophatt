// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Seite Kaderplanung: ganzer Kader mit Rollen, Bedarf je Mannschaftsteil, Schritte, Zeitleiste der Stammbesetzung.

import { ROLE_DE, type SquadPlan, type SquadRole, type PlannedPlayer, USABLE_BACKUP, TALENT_MAX_AGE, TALENT_SHARE } from "../core/squadplan";
import { GROUP_SHORT, type GroupPlan, BACKUP_SHARE } from "../core/squad";
import { fixed, loc } from "../core/locale";

export type PlanFilter = SquadRole | "all";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const euro = (v: number) => `${Math.round(v).toLocaleString(loc())} €`;
const de1 = (x: number) => fixed(x, 1);
const ROLE_ORDER: SquadRole[] = ["starter", "backup", "talent", "surplus"];
const STATUS: Record<string, [string, string, string]> = {
  gap: ["critical", "!", "Lücke"],
  thin: ["warning", "–", "dünn"],
  ok: ["good", "✓", "passt"],
  crowded: ["serious", "+", "zu viele"],
};
const ACTION_ICON: Record<string, string> = { fill: "!", successor: "↻", sell: "€", develop: "↑" };

const roleChip = (r: SquadRole) => `<span class="sp-role ${r}">${ROLE_DE[r]}</span>`;

function trend(now: number, later: number): string {
  if (!now) return "";
  const d = later / now - 1;
  if (Math.abs(d) < 0.03) return `<span class="muted">±0 %</span>`;
  return `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : ""}${Math.round(d * 100)} %</span>`;
}

/** Balken heute (voll) und in zwei Saisons (Umriss), gemessen am Stärksten der Gruppe */
function bar(x: PlannedPlayer, max: number): string {
  const w = (v: number) => `${Math.max(2, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  return `<span class="sp-bar" title="heute ${de1(x.now)}, in zwei Saisons ${de1(x.later)}"><i class="now" style="width:${w(x.now)}"></i><i class="later" style="width:${w(x.later)}"></i></span>`;
}

function groupCard(g: SquadPlan["groups"][number]): string {
  const [cls, icon, label] = STATUS[g.status];
  const members = [...g.starters, ...g.backups, ...g.talents, ...g.surplus];
  const max = Math.max(1e-6, ...members.flatMap((m) => [m.now, m.later]));
  const rows = members
    .map(
      (m) => `<li class="${m.role}${m.player.injury > 0 ? " hurt" : ""}">
        ${roleChip(m.role)}
        <span class="sp-name" title="${esc(m.player.name)}">${esc(m.player.name.split(" ").slice(-1)[0])} <span class="muted">${m.player.age} J.</span>${m.player.injury > 0 ? ` <span class="down" title="verletzt">✚${m.player.injury}</span>` : ""}</span>
        ${bar(m, max)}
        <span class="sp-val">${de1(m.now)} → ${de1(m.later)}</span>
      </li>`,
    )
    .join("");
  return `<article class="sp-group ${g.status}">
    <header><h4>${esc(g.name)}</h4><span class="status ${cls}"><i>${icon}</i>${label}</span></header>
    <div class="sp-count"><b>${members.length} Spieler</b> · ${g.places} ${g.places === 1 ? "Platz" : "Plätze"} · Soll ${g.target}</div>
    <div class="sub">Stammspieler ${de1(g.strengthNow)} → ${de1(g.strengthLater)} in zwei Saisons ${trend(g.strengthNow, g.strengthLater)}</div>
    <ul class="sp-list">${rows}</ul>
  </article>`;
}

function timeline(P: GroupPlan[]): string {
  if (!P.length) return "";
  const backupHtml = (b: GroupPlan["horizons"][number]["backup"]) => {
    if (!b) return `<br><span class="down">Ersatz: keiner</span>`;
    return `<br><span class="${b.share >= BACKUP_SHARE ? "muted" : "down"}">Ersatz: ${esc(b.name.split(" ").slice(-1)[0])} (${de1(b.value)}, ${Math.round(b.share * 100)} %)</span>`;
  };
  const cell = (h: GroupPlan["horizons"][number], base: number, i: number) =>
    `<td class="st"><span class="val">${de1(h.average)}</span>${i ? ` ${trend(base, h.average)}` : ""}<br>${h.starters.map((e) => `${esc(e.name.split(" ").slice(-1)[0])} <span class="muted">${e.age}</span>`).join(", ")}${backupHtml(h.backup)}</td>`;
  return `<details class="sp-timeline"><summary>Stammbesetzung jetzt, in einer und in zwei Saisons</summary>
    <div class="scroll"><table class="plan"><thead><tr><th>Mannschaftsteil</th><th>Jetzt</th><th>In 1 Saison</th><th>In 2 Saisons</th><th>Bewertung</th></tr></thead><tbody>
    ${P.map((g) => `<tr><td><b>${esc(g.name)}</b><br><span class="muted">${g.needed} ${g.needed === 1 ? "Platz" : "Plätze"}</span></td>${g.horizons.map((h, i) => cell(h, g.horizons[0].average, i)).join("")}<td><span class="sub">${esc(g.note)}</span></td></tr>`).join("")}
    </tbody></table></div>
    <p class="sub">Später bleiben die Stammspieler auf ihren Plätzen, bis ein anderer Spieler dort stärker ist und als Nachfolger übernimmt. Ersatz: je Mannschaftsteil einer, Prozent im Vergleich zum schwächsten Stammspieler, gleichwertig ab ${Math.round(BACKUP_SHARE * 100)} %.</p>
  </details>`;
}

export function planViewHtml(plan: SquadPlan, timelinePlans: GroupPlan[], basis: string, filter: PlanFilter): string {
  const count = (r: SquadRole) => plan.players.filter((x) => x.role === r).length;
  const surplus = count("surplus");
  const gaps = plan.groups.filter((g) => g.missing > 0);
  const tile = (k: string, v: string, sub: string, cls = "") => `<div class="tile fin-tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></div>`;
  const kpis = `<div class="tiles show sp-kpis">
    ${tile("Kader", `${plan.size} Spieler`, `Bedarf ${plan.target}: ${plan.groups.reduce((s, g) => s + g.places, 0)} Plätze und je Platz ein Ersatz`, plan.size > plan.target + 3 ? "neg" : "")}
    ${tile("Überzählig", String(surplus), surplus ? `${euro(plan.surplusSalary)} Gehalt pro Woche` : "jeder hat eine Rolle", surplus ? "neg" : "pos")}
    ${tile("Lücken", String(gaps.reduce((s, g) => s + g.missing, 0)), gaps.length ? gaps.map((g) => esc(g.name)).join(", ") : "alle Mannschaftsteile mit Ersatz", gaps.length ? "neg" : "pos")}
    ${tile("Ø Alter", `${fixed(plan.averageAge, 1)} J.`, `Gehalt gesamt ${euro(plan.salary)} pro Woche`)}
  </div>`;

  const actions = plan.actions.length
    ? `<ol class="sp-actions">${plan.actions
        .map((a) => `<li class="${a.kind}"><i aria-hidden="true">${ACTION_ICON[a.kind]}</i><div><b>${esc(a.title)}</b><span class="sub">${esc(a.text)}</span>${a.kind === "fill" ? ` <a class="linkbtn" href="#transfers">Suchprofil ansehen</a>` : ""}</div></li>`)
        .join("")}</ol>`
    : `<p class="muted">Nichts zu tun: Jeder Mannschaftsteil hat Ersatz, niemand ist überzählig.</p>`;

  const groups = `<div class="sp-groups">${plan.groups.map(groupCard).join("")}</div>`;

  const seg = `<div class="seg sp-filter" role="group" aria-label="Rolle">${(["all", ...ROLE_ORDER] as PlanFilter[])
    .map((f) => `<button type="button" data-planfilter="${f}" class="${f === filter ? "on" : ""}" aria-pressed="${f === filter}">${f === "all" ? "Alle" : ROLE_DE[f]} (${f === "all" ? plan.players.length : count(f)})</button>`)
    .join("")}</div>`;
  const rows = plan.players
    .filter((x) => filter === "all" || x.role === filter)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.later - a.later)
    .map(
      (x) => `<tr class="${x.role}"><td><b>${esc(x.player.name)}</b></td><td class="num">${x.player.age}</td><td>${GROUP_SHORT[x.group]}</td><td>${roleChip(x.role)}</td>
        <td class="num">${de1(x.now)}</td><td class="num">${de1(x.later)} ${trend(x.now, x.later)}</td><td class="num">${euro(x.player.salary)}</td><td class="sub">${esc(x.reason)}</td></tr>`,
    )
    .join("");
  const table = `<div class="scroll"><table class="sp-table"><thead><tr><th>Spieler</th><th class="num">Alter</th><th>Teil</th><th>Rolle</th><th class="num">Stärke</th><th class="num">In 2 Saisons</th><th class="num">Gehalt</th><th>Warum</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  return `${kpis}
    <h3>Was zu tun ist</h3>${actions}
    <h3>Bedarf je Mannschaftsteil</h3>
    <p class="sub">Jeder Spieler steht einmal, dort, wo er gebraucht wird. Balken: heute (voll) und in zwei Saisons (Umriss).</p>
    ${groups}
    <h3>Alle Spieler</h3>${seg}${table}
    ${timeline(timelinePlans)}
    <p class="sub">Berechnet nach ${esc(basis)}. Soll je Mannschaftsteil: Plätze plus je Platz ein Ersatz, im Tor zwei. Ersatz ist, wer heute mindestens ${Math.round(USABLE_BACKUP * 100)} % des schwächsten Stammspielers erreicht, jeder nur einmal. Talent: bis ${TALENT_MAX_AGE} Jahre und in zwei Saisons mindestens ${Math.round(TALENT_SHARE * 100)} % der Stammspieler. Überzählig: weder Stamm, Ersatz noch Talent. Stärke = HO-Positionsstärke, in zwei Saisons mit Training und Altersabbau wie in der Spielerentwicklung.</p>`;
}
