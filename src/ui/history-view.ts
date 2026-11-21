// Seite „Verlauf“: Wochen-Schnappschüsse speichern, anzeigen, exportieren.
// Speicherorte: localStorage (immer) und, wenn erlaubt, tophatt-verlauf.json im verbundenen Datenordner.

import {
  type Change,
  type HistoryArchive,
  type WeekSnapshot,
  archiveCsv,
  diffWeeks,
  euro,
  mergeArchives,
  mergeSnapshot,
  parseArchive,
  serializeArchive,
  snapshotFromHrf,
  weekMetrics,
  weekOf,
} from "../core/history";
import { type DirHandle, fileByName, isHoExport } from "./folder";

export const HISTORY_FILE = "tophatt-verlauf.json";
const KEY = "tophatt.verlauf";
/** Planwerte anderer Seiten, die mit der laufenden Woche gespeichert werden */
const PLAN_KEYS: Record<string, string> = { trainerPlan: "tophatt.trainerPlan" };

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

let archive: HistoryArchive = load();
let folder: () => DirHandle | null = () => null;
/** Schreibrecht im Datenordner für diese Sitzung erteilt */
let canWrite = false;
let lastFolderSave = "";

function load(): HistoryArchive {
  try {
    return parseArchive(localStorage.getItem(KEY));
  } catch {
    return parseArchive(null);
  }
}

function currentPlans(): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(PLAN_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) out[name] = JSON.parse(raw);
    } catch {
      /* kaputter Planwert: weglassen */
    }
  }
  return Object.keys(out).length ? out : undefined;
}

async function save() {
  const json = serializeArchive(archive);
  try {
    localStorage.setItem(KEY, json);
  } catch {
    /* Speicher voll oder gesperrt: Datei-Export bleibt */
  }
  if (canWrite) await writeFolder(json);
}

async function writeFolder(json: string) {
  const h = folder();
  if (!h || json === lastFolderSave) return;
  try {
    const fh = await (h as FileSystemDirectoryHandle).getFileHandle(HISTORY_FILE, { create: true });
    const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(json);
    await w.close();
    lastFolderSave = json;
  } catch {
    canWrite = false;
  }
  renderStatus();
}

type RwHandle = { queryPermission(o: { mode: string }): Promise<PermissionState>; requestPermission(o: { mode: string }): Promise<PermissionState> };

/** Schnappschuss der gerade geladenen HRF ins Archiv übernehmen (mit den aktuellen Planwerten, wenn es die laufende Woche ist). */
export function recordHrf(text: string) {
  const s = snapshotFromHrf(text);
  if (!s) return;
  if (s.week === weekOf(new Date())) {
    const plans = currentPlans();
    if (plans) s.plans = plans;
  }
  if (mergeSnapshot(archive, s)) void save();
}

/**
 * Datenordner einlesen: vorhandenes Archiv (tophatt-verlauf.json) und alle HO-Exporte,
 * damit auch Wochen vor dem ersten Start dieser Seite im Verlauf landen.
 */
export async function syncFolder(h: DirHandle) {
  let changed = false;
  try {
    const f = await fileByName(h, HISTORY_FILE);
    if (f) changed = mergeArchives(archive, parseArchive(await f.text())) > 0 || changed;
    for await (const entry of h.values()) {
      if (entry.kind !== "file" || !isHoExport(entry.name)) continue;
      const s = snapshotFromHrf(await (await (entry as FileSystemFileHandle).getFile()).text());
      if (s && mergeSnapshot(archive, s)) changed = true;
    }
    canWrite = (await (h as unknown as RwHandle).queryPermission({ mode: "readwrite" })) === "granted";
  } catch {
    /* Ordner nicht lesbar: dann eben nur der lokale Verlauf */
  }
  if (changed || canWrite) await save();
  renderHistory();
}

async function enableFolderSave() {
  const h = folder();
  if (!h) {
    alertInline("Zuerst unter Einstellungen den HO-Datenordner verbinden.");
    return;
  }
  try {
    canWrite = (await (h as unknown as RwHandle).requestPermission({ mode: "readwrite" })) === "granted";
  } catch {
    canWrite = false;
  }
  if (canWrite) {
    lastFolderSave = "";
    await save();
  } else alertInline("Ohne Schreibrecht bleibt der Verlauf im Browser gespeichert. Sichere ihn dann ab und zu über „Exportieren“.");
  renderStatus();
}

function alertInline(text: string) {
  const el = $("#historyMsg");
  if (el) el.textContent = text;
}

function downloadText(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Datei-Import (JSON-Archiv) */
export async function importFile(file: File): Promise<number> {
  const n = mergeArchives(archive, parseArchive(await file.text()));
  if (n) await save();
  renderHistory();
  return n;
}

export function initHistory(getFolder: () => DirHandle | null) {
  folder = getFolder;
  const root = $("#verlauf");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-hact]");
    if (!b) return;
    const act = b.dataset.hact;
    const stamp = new Date().toISOString().slice(0, 10);
    if (act === "json") downloadText(`tophatt-verlauf-${stamp}.json`, serializeArchive(archive), "application/json");
    if (act === "csv") downloadText(`tophatt-verlauf-${stamp}.csv`, archiveCsv(archive.weeks), "text/csv;charset=utf-8");
    if (act === "import") $<HTMLInputElement>("#historyFile").click();
    if (act === "folder") void enableFolderSave();
  });
  $<HTMLInputElement>("#historyFile").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const n = await importFile(f);
    alertInline(n ? `${n} Woche${n === 1 ? "" : "n"} übernommen.` : "Keine neuen Wochen in der Datei.");
    input.value = "";
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (!t.matches("[data-note]")) return;
    const w = archive.weeks.find((x) => x.week === t.dataset.note);
    if (!w) return;
    const v = t.value.trim();
    if (v) w.note = v;
    else delete w.note;
    void save();
    t.closest(".hweek")?.classList.add("saved");
    setTimeout(() => t.closest(".hweek")?.classList.remove("saved"), 1200);
  });
}

// --- Darstellung -----------------------------------------------------------------------

const dateDe = (week: string) => {
  const [y, m, d] = week.split("-");
  return `${d}.${m}.${y}`;
};
const shortDe = (week: string) => {
  const [, m, d] = week.split("-");
  return `${d}.${m}.`;
};
const fmtNum = (v: number) => Math.round(v).toLocaleString("de-DE");

function renderStatus() {
  const el = $("#historyStore");
  if (!el) return;
  const h = folder();
  el.innerHTML = canWrite && h
    ? `Gespeichert im Browser und in <b>${esc(h.name)}\\${HISTORY_FILE}</b>.`
    : `Gespeichert im Browser.${h ? ` <button class="linkbtn" data-hact="folder">Zusätzlich im Datenordner sichern</button>` : ""}`;
}

interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  fmt?: (v: number) => string;
  /** kurze Achsenbeschriftung (sonst fmt) */
  axis?: (v: number) => string;
}

/** Geld kurz für Achsen: 14.660 € → 14,7 T€, 921.000 € → 921 T€ */
const euroShort = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Mio €` : Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("de-DE", { maximumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 1 })} T€` : `${Math.round(v)} €`);

/** Kleines Liniendiagramm über die Wochen (gleich breite Schritte) */
function lineChart(weeks: string[], series: Series[], opt: { invert?: boolean; integer?: boolean; bars?: boolean; min?: number; max?: number } = {}): string {
  const W = 360,
    H = 150,
    ml = 54,
    mr = 14,
    mt = 12,
    mb = 24;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!vals.length) return `<p class="sub">Noch keine Werte.</p>`;
  let lo = opt.min ?? Math.min(...vals);
  let hi = opt.max ?? Math.max(...vals);
  if (opt.bars) lo = Math.min(0, lo);
  if (lo === hi) (lo -= opt.integer ? 1 : Math.abs(lo) * 0.1 || 1), (hi += opt.integer ? 1 : Math.abs(hi) * 0.1 || 1);
  if (opt.integer) (lo = Math.floor(lo)), (hi = Math.ceil(hi));
  const n = weeks.length;
  const X = (i: number) => (n === 1 ? (ml + W - mr) / 2 : ml + (i / (n - 1)) * (W - ml - mr));
  const Y = (v: number) => {
    const r = (v - lo) / (hi - lo);
    return mt + (opt.invert ? r : 1 - r) * (H - mt - mb);
  };
  const fmt0 = series[0].fmt ?? ((v: number) => fmtNum(v));
  const axis = series[0].axis ?? fmt0;
  const ticks = opt.integer
    ? hi - lo <= 6
      ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
      : [lo, Math.round((lo + hi) / 2), hi]
    : [lo, (lo + hi) / 2, hi];
  let g = ticks
    .map((v) => `<line x1="${ml}" x2="${W - mr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)"/><text x="${ml - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(axis(v))}</text>`)
    .join("");
  const labelIdx = n <= 6 ? weeks.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  g += labelIdx.map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${shortDe(weeks[i])}</text>`).join("");
  let marks = "";
  if (opt.bars) {
    const bw = Math.min(28, ((W - ml - mr) / Math.max(1, n)) * 0.6);
    for (const s of series)
      s.values.forEach((v, i) => {
        if (v === null) return;
        const y0 = Y(0),
          y1 = Y(v);
        marks += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="3" fill="${s.color}"><title>${dateDe(weeks[i])}: ${esc((s.fmt ?? fmt0)(v))} ${esc(s.name)}</title></rect>`;
      });
  } else {
    for (const s of series) {
      let d = "";
      let pen = false;
      s.values.forEach((v, i) => {
        if (v === null) return void (pen = false);
        d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      });
      marks += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      marks += s.values
        .map((v, i) => (v === null ? "" : `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"><title>${dateDe(weeks[i])}: ${esc((s.fmt ?? fmt0)(v))}${series.length > 1 ? ` (${esc(s.name)})` : ""}</title></circle>`))
        .join("");
    }
  }
  const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>` : "";
  return `${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map((s) => s.name).join(", "))} je Woche">${g}${marks}</svg>`;
}

function chip(c: Change): string {
  const cls = c.tone > 0 ? "up" : c.tone < 0 ? "down" : "";
  const val = c.from !== undefined ? ` <span class="ft">${esc(c.from)} → <b>${esc(c.to ?? "")}</b></span>` : "";
  return `<span class="hchip ${cls}">${esc(c.label)}${val}</span>`;
}

function settingsLine(w: WeekSnapshot): string {
  const s = w.staff;
  const parts = [
    `<b>${esc(w.training.typeName || "Training ?")}</b> ${w.training.intensity} %`,
    `Kondition ${w.training.staminaShare} %`,
    `Trainer ${s.trainerLevel ?? "?"}`,
    `Assistenten ${s.assistants}`,
  ];
  if (s.medics) parts.push(`Mediziner ${s.medics}`);
  if (s.psychologists) parts.push(`Psychologe ${s.psychologists}`);
  if (s.formCoaches) parts.push(`Formtrainer ${s.formCoaches}`);
  if (s.tacticalAssistants) parts.push(`Taktik ${s.tacticalAssistants}`);
  if (s.costPerWeek !== null) parts.push(`Personal ${euro(s.costPerWeek)}/Woche`);
  if (w.finance) parts.push(`Konto ${euro(w.finance.cash)}`);
  if (w.team.leaguePosition) parts.push(`Platz ${w.team.leaguePosition}`);
  return parts.join(" · ");
}

function planLine(w: WeekSnapshot): string {
  type Plan = { trainerLevel?: number; assistants?: unknown[]; intensity?: number; staminaShare?: number };
  const raw = w.plans?.trainerPlan as (Plan & { plan?: Plan }) | undefined;
  if (!raw || typeof raw !== "object") return "";
  const p: Plan = raw.plan && typeof raw.plan === "object" ? raw.plan : raw;
  const bits: string[] = [];
  if (typeof p.trainerLevel === "number") bits.push(`Trainer ${p.trainerLevel}`);
  if (Array.isArray(p.assistants))
    bits.push(`Assistenten ${p.assistants.reduce<number>((s, a) => s + (typeof a === "number" ? a : Number((a as { level?: number })?.level) || 0), 0)}`);
  if (typeof p.intensity === "number") bits.push(`Intensität ${p.intensity} %`);
  if (typeof p.staminaShare === "number") bits.push(`Kondition ${p.staminaShare} %`);
  return bits.length ? `<p class="sub">Geplant (Trainer-Planung): ${esc(bits.join(" · "))}</p>` : "";
}

export function renderHistory() {
  const out = $("#historyOut");
  if (!out) return;
  renderStatus();
  const weeks = archive.weeks;
  $("#historySub").textContent = weeks.length ? `${weeks.length} Woche${weeks.length === 1 ? "" : "n"} gespeichert, seit ${dateDe(weeks[0].week)}` : "Noch nichts gespeichert";
  if (!weeks.length) {
    out.innerHTML = `<p>Sobald eine HRF-Datei geladen ist, speichert TopHatt hier jede Woche Training, Trainer, Personal, Finanzen und Kader.</p>`;
    return;
  }
  const m = weekMetrics(weeks);
  const labels = weeks.map((w) => w.week);
  const first = weeks[0],
    last = weeks[weeks.length - 1];
  const totalUps = m.reduce((s, x) => s + (x.skillUps ?? 0), 0);
  const kpi = (label: string, value: string, sub = "") => `<div class="hkpi"><span class="sub">${label}</span><b>${value}</b>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  const cashDelta = first.finance && last.finance ? last.finance.cash - first.finance.cash : null;
  const kpis = [
    kpi("Fähigkeitsaufstiege", String(totalUps), weeks.length > 1 ? `in ${weeks.length - 1} Woche${weeks.length === 2 ? "" : "n"}` : "ab der 2. Woche"),
    kpi("Personal pro Woche", last.staff.costPerWeek !== null ? euro(last.staff.costPerWeek) : "–", first.staff.costPerWeek !== null && last.staff.costPerWeek !== null && weeks.length > 1 ? `Start ${euro(first.staff.costPerWeek)}` : ""),
    kpi("Kontostand", last.finance ? euro(last.finance.cash) : "–", cashDelta !== null && weeks.length > 1 ? `${cashDelta >= 0 ? "+" : "−"}${euro(Math.abs(cashDelta))} seit Start` : ""),
    kpi("Tabellenplatz", last.team.leaguePosition ? `${last.team.leaguePosition}.` : "–", weeks.length > 1 && first.team.leaguePosition ? `Start ${first.team.leaguePosition}.` : ""),
  ].join("");

  const charts = weeks.length > 1
    ? `<div class="hcharts">
      <div><h3>Trainer und Assistenten</h3>${lineChart(labels, [
        { name: "Trainerfähigkeit", color: "var(--s1)", values: m.map((x) => x.trainerLevel) },
        { name: "Assistenten (Stufen)", color: "var(--s2)", values: m.map((x) => x.assistants) },
      ], { integer: true, min: 0 })}</div>
      <div><h3>Fähigkeitsaufstiege je Woche</h3>${lineChart(labels, [{ name: "Aufstiege", color: "var(--s3)", values: m.map((x) => x.skillUps) }], { integer: true, bars: true })}</div>
      <div><h3>Personalkosten pro Woche</h3>${lineChart(labels, [{ name: "Personal", color: "var(--s2)", values: m.map((x) => x.staffCost), fmt: euro, axis: euroShort }], { min: 0 })}</div>
      <div><h3>Kontostand</h3>${lineChart(labels, [{ name: "Kontostand", color: "var(--s1)", values: m.map((x) => x.cash), fmt: euro, axis: euroShort }])}</div>
      <div><h3>Training</h3>${lineChart(labels, [
        { name: "Intensität %", color: "var(--s1)", values: m.map((x) => x.intensity) },
        { name: "Kondition %", color: "var(--s3)", values: m.map((x) => x.staminaShare) },
      ], { min: 0, max: 100 })}</div>
      <div><h3>Tabellenplatz</h3>${lineChart(labels, [{ name: "Platz", color: "var(--s1)", values: m.map((x) => x.leaguePosition), fmt: (v) => `${v}.` }], { invert: true, integer: true, min: 1, max: 8 })}</div>
    </div>`
    : `<p class="sub">Erste Woche gespeichert. Ab dem ersten HO-Download nach dem nächsten Freitagstraining siehst du hier Linien und Änderungen.</p>`;

  const cards = weeks
    .map((w, i) => {
      const prev = i > 0 ? weeks[i - 1] : null;
      const ch = prev ? diffWeeks(prev, w) : [];
      const settings = ch.filter((c) => c.kind === "setting" || c.kind === "staff");
      const skills = ch.filter((c) => c.kind === "skill");
      const other = ch.filter((c) => c.kind === "result" || c.kind === "squad");
      const group = (title: string, list: Change[], max = 99) =>
        list.length ? `<div class="hgroup"><span class="sub">${title}</span>${list.slice(0, max).map(chip).join("")}${list.length > max ? `<span class="sub">+${list.length - max} weitere</span>` : ""}</div>` : "";
      const body = prev
        ? ch.length
          ? group("Einstellungen", settings) + group("Fähigkeiten", skills, 12) + group("Ergebnisse und Kader", other)
          : `<p class="sub">Keine Änderungen zur Vorwoche.</p>`
        : `<p class="sub">Startpunkt des Verlaufs.</p>`;
      return `<article class="hweek">
        <header><h3>Woche ab Fr ${dateDe(w.week)}</h3><span class="sub">Saison ${w.season}${w.round ? `, Spieltag ${w.round}` : ""} · Stand ${esc(w.hrfDate.slice(8, 10) + "." + w.hrfDate.slice(5, 7) + ". " + w.hrfDate.slice(11, 16))}</span></header>
        <p class="hset">${settingsLine(w)}</p>
        ${planLine(w)}
        ${body}
        <textarea data-note="${w.week}" rows="2" placeholder="Notiz zur Woche: Was hast du geändert und warum? Was soll bis wann passieren?">${esc(w.note ?? "")}</textarea>
      </article>`;
    })
    .reverse()
    .join("");

  out.innerHTML = `<div class="hkpis">${kpis}</div>${charts}<h3 class="hhead">Woche für Woche</h3>${cards}`;
}
