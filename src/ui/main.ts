// TopHatt-Oberfläche: eine einzige HTML-Seite, läuft offline im Browser. Keine Daten verlassen den Rechner.

import { DATA_FILE, type DirHandle, askPermission, chooseFolder, fileByName, folderApiAvailable, hasPermission, newestFile, storedFolder } from "./folder";
import { parseHrf, writeLineupToHrf } from "../core/hrf";
import { Attitude, Location, Role, Tactic, type Hrf, type Lineup, type MatchSettings, type Player } from "../core/model";
import { HATSTATS_OBJECTIVE, formationLabel, optimizeLineup, type OptimizeResult } from "../core/optimizer";
import { type RatingSector, lineupSector, playerPositionRating, ratingLabel } from "../core/rating";
import { TRAININGS, planFriendly, trainingFor, trainingPriority, type FriendlyPlan } from "../core/training";
import { advise, type Advice } from "../core/advisor";
import { type HoData, type HoMatch, MATCH_TYPE_DE, WEATHER_DE, parseHoData, roundOf, standings, upcomingMatches } from "../core/hodata";
import { DEV_SKILL_DE, type DevSkill, type PlayerOutlook, type TrainingSetup, mainSkills, outlookFor, project, skillsOf } from "../core/development";
import { type SectorAssessment, assessSectors } from "../core/weakness";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtDate = (d: Date) => d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const fmtDateTime = (d: Date) => d.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtShort = (d: Date) => d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const ROLE_DE: Record<number, string> = {
  [Role.keeper]: "TW",
  [Role.rightBack]: "RV",
  [Role.rightCentralDefender]: "IV r",
  [Role.middleCentralDefender]: "IV m",
  [Role.leftCentralDefender]: "IV l",
  [Role.leftBack]: "LV",
  [Role.rightWinger]: "RF",
  [Role.rightInnerMidfield]: "ZM r",
  [Role.centralInnerMidfield]: "ZM m",
  [Role.leftInnerMidfield]: "ZM l",
  [Role.leftWinger]: "LF",
  [Role.rightForward]: "ST r",
  [Role.centralForward]: "ST m",
  [Role.leftForward]: "ST l",
};
const BEHAVIOUR_DE = ["", "offensiv", "defensiv", "zur Mitte", "nach außen"];
const BENCH_DE: Record<string, string> = {
  keeper: "Torwart",
  centralDefender: "Innenverteidiger",
  wingBack: "Außenverteidiger",
  innerMidfield: "Mittelfeld",
  forward: "Sturm",
  winger: "Flügel",
  extra: "Joker",
};
const SPECIALTY_DE = ["", "Ballzauberer", "schnell", "durchsetzungsstark", "unberechenbar", "Kopfballstark", "Balleroberer", "", "Teamplayer"];
const SECTOR_NAME: Record<string, string> = {
  goal: "Torwart",
  back: "Außenverteidiger",
  centralDefence: "Innenverteidiger",
  wing: "Flügel",
  innerMidfield: "Mittelfeld",
  forward: "Sturm",
};

// Spielfeld-Raster: Zeile (0 = Sturm oben), Spalte (0 = links aus Sicht des eigenen Tors)
const GRID: Record<number, [number, number]> = {
  [Role.leftForward]: [0, 1],
  [Role.centralForward]: [0, 2],
  [Role.rightForward]: [0, 3],
  [Role.leftWinger]: [1, 0],
  [Role.leftInnerMidfield]: [1, 1],
  [Role.centralInnerMidfield]: [1, 2],
  [Role.rightInnerMidfield]: [1, 3],
  [Role.rightWinger]: [1, 4],
  [Role.leftBack]: [2, 0],
  [Role.leftCentralDefender]: [2, 1],
  [Role.middleCentralDefender]: [2, 2],
  [Role.rightCentralDefender]: [2, 3],
  [Role.rightBack]: [2, 4],
  [Role.keeper]: [3, 2],
};
/** Welche Mannschaftsteile eine Position vor allem trägt (für die Markierung auf dem Spielfeld) */
const ROLE_SECTORS: Record<number, RatingSector[]> = {
  [Role.keeper]: ["defenceCentral"],
  [Role.rightBack]: ["defenceRight"],
  [Role.leftBack]: ["defenceLeft"],
  [Role.rightCentralDefender]: ["defenceCentral", "defenceRight"],
  [Role.middleCentralDefender]: ["defenceCentral"],
  [Role.leftCentralDefender]: ["defenceCentral", "defenceLeft"],
  [Role.rightWinger]: ["attackRight", "midfield"],
  [Role.leftWinger]: ["attackLeft", "midfield"],
  [Role.rightInnerMidfield]: ["midfield"],
  [Role.centralInnerMidfield]: ["midfield"],
  [Role.leftInnerMidfield]: ["midfield"],
  [Role.rightForward]: ["attackCentral", "attackRight"],
  [Role.centralForward]: ["attackCentral"],
  [Role.leftForward]: ["attackCentral", "attackLeft"],
};

interface State {
  hrf: Hrf | null;
  hrfName: string;
  hrfTime: number;
  ho: HoData | null;
  folder: DirHandle | null;
  match: HoMatch | null;
  league: OptimizeResult | null;
  friendly: FriendlyPlan | null;
  advice: Advice | null;
  weak: SectorAssessment[];
  outlooks: Map<number, PlayerOutlook>;
  setup: TrainingSetup | null;
  devPlayer: number;
  settings: MatchSettings;
}

const state: State = {
  hrf: null,
  hrfName: "",
  hrfTime: 0,
  ho: null,
  folder: null,
  match: null,
  league: null,
  friendly: null,
  advice: null,
  weak: [],
  outlooks: new Map(),
  setup: null,
  devPlayer: 0,
  settings: { location: Location.home, tactic: Tactic.normal, attitude: Attitude.normal, styleOfPlay: 0, teamSpiritSubIndex: 2 },
};

const playersById = () => new Map((state.hrf?.players ?? []).map((p) => [p.id, p]));
const teamState = () => ({ teamSpirit: state.hrf!.team.teamSpirit, confidence: state.hrf!.team.confidence });

function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// --- Daten laden ---------------------------------------------------------------

async function setHrf(file: File) {
  const hrf = parseHrf(await file.text());
  if (!hrf.players.length) throw new Error(`In ${file.name} wurden keine Spieler gefunden. Ist es eine HRF-Datei aus HO?`);
  state.hrf = hrf;
  state.hrfName = file.name;
  state.hrfTime = file.lastModified;
}

async function setHoData(file: File) {
  state.ho = parseHoData(await file.text());
}

async function loadFiles(files: File[]) {
  $("#error").textContent = "";
  try {
    const hrfs = files.filter((f) => f.name.toLowerCase().endsWith(".hrf")).sort((a, b) => b.lastModified - a.lastModified);
    const json = files.find((f) => f.name.toLowerCase().endsWith(".json"));
    if (hrfs[0]) await setHrf(hrfs[0]);
    if (json) await setHoData(json);
    afterLoad(true);
  } catch (e) {
    $("#error").textContent = (e as Error).message;
  }
}

async function loadFromFolder(h: DirHandle) {
  const hrf = await newestFile(h);
  if (!hrf) {
    $("#folderStatus").textContent = `Im Ordner „${h.name}“ liegt keine .hrf-Datei aus HO.`;
    $("#emptyStatus").textContent = $("#folderStatus").textContent;
    return;
  }
  await setHrf(hrf);
  const data = await fileByName(h, DATA_FILE);
  state.ho = data ? parseHoData(await data.text()) : null;
  $("#folderStatus").textContent = `Verbunden mit „${h.name}“. Geladen: ${hrf.name}${data ? ` und ${DATA_FILE}` : ""}.`;
  afterLoad(true);
}

async function refresh() {
  const btn = $("#refresh");
  if (!state.folder) {
    openSettings();
    return;
  }
  btn.classList.add("spin");
  try {
    if (!(await hasPermission(state.folder)) && !(await askPermission(state.folder))) {
      toast("Zugriff auf den Ordner wurde nicht erlaubt.");
      return;
    }
    const before = `${state.hrfName}|${state.hrfTime}|${state.ho?.generated.getTime()}`;
    await loadFromFolder(state.folder);
    const after = `${state.hrfName}|${state.hrfTime}|${state.ho?.generated.getTime()}`;
    toast(before === after ? "Keine neueren Daten gefunden." : "Daten aktualisiert.");
  } catch (e) {
    $("#error").textContent = (e as Error).message;
  } finally {
    btn.classList.remove("spin");
  }
}

/** Nach dem Laden: nächstes Spiel bestimmen und die Spieleinstellungen daraus übernehmen */
function afterLoad(resetMatch: boolean) {
  const hrf = state.hrf;
  if (!hrf) return;
  if (resetMatch) {
    const up = state.ho ? upcomingMatches(state.ho).filter((m) => [1, 2, 3].includes(m.type)) : [];
    state.match = up[0] ?? null;
    const m = state.match;
    const teamId = hrf.team.teamId;
    if (m) {
      const loc = m.neutral ? Location.neutral : m.homeId === teamId ? Location.home : m.derby ? Location.awayDerby : Location.away;
      const sel = $<HTMLSelectElement>("#location");
      sel.value = String(loc === Location.neutral ? Location.away : loc);
      $<HTMLInputElement>("#matchId").value = String(m.id);
      $<HTMLSelectElement>("#matchType").value = m.type === 3 ? "3" : "1";
    } else {
      $<HTMLInputElement>("#matchId").value = hrf.lineupMatchId ? String(hrf.lineupMatchId) : "";
      if ([1, 3].includes(hrf.lineupMatchType)) $<HTMLSelectElement>("#matchType").value = String(hrf.lineupMatchType);
    }
  }
  compute();
}

// --- Berechnung -----------------------------------------------------------------

function readSettings() {
  state.settings = {
    location: Number($<HTMLSelectElement>("#location").value) as MatchSettings["location"],
    tactic: Number($<HTMLSelectElement>("#tactic").value) as MatchSettings["tactic"],
    attitude: Number($<HTMLSelectElement>("#attitude").value) as MatchSettings["attitude"],
    styleOfPlay: Number($<HTMLSelectElement>("#style").value),
    teamSpiritSubIndex: 2,
  };
}

function trainingSetup(): TrainingSetup {
  const hrf = state.hrf!;
  const ho = state.ho;
  const planned = ho?.futureTraining.find((t) => t.type >= 0) ?? [...(ho?.training ?? [])].reverse().find((t) => t.type >= 0);
  return {
    type: planned?.type ?? hrf.team.trainingType,
    intensity: planned?.intensity || hrf.team.trainingLevel || 100,
    staminaShare: planned?.staminaShare ?? hrf.team.staminaTrainingPart ?? 15,
    coachLevel: planned?.coachLevel || 6,
    assistantsLevel: planned?.assistantsLevel ?? 0,
  };
}

function compute() {
  const hrf = state.hrf;
  if (!hrf) return render();
  readSettings();
  const team = teamState();
  try {
    state.league = optimizeLineup(hrf.players, state.settings, team, {
      minFormationExperience: Number($<HTMLSelectElement>("#minExp").value),
      formationExperience: hrf.team.formationExperience,
      objective: HATSTATS_OBJECTIVE,
      allowBruised: $<HTMLInputElement>("#bruised").checked,
      tryBehaviours: $<HTMLInputElement>("#behaviours").checked,
    });
    state.friendly = planFriendly(hrf.players, state.league.lineup, hrf.team.trainingType, $<HTMLInputElement>("#bruised").checked);
    state.advice = advise(hrf.players, state.league.lineup, state.settings, team, hrf.team.trainingType);
    state.weak = assessSectors(hrf.players, state.league.lineup, state.league.ratings, state.settings, team);
    state.setup = trainingSetup();
    state.outlooks = new Map(hrf.players.map((p) => [p.id, outlookFor(p, startSkills(p), state.setup!, trainingShare(p.id))]));
    $("#error").textContent = "";
  } catch (e) {
    $("#error").textContent = (e as Error).message;
  }
  render();
}

/** Anteil Training der Trainingsfertigkeit pro Woche: Liga- oder Freundschaftsspiel auf Trainingsposition */
function trainingShare(id: number): number {
  const F = state.friendly;
  const hrf = state.hrf!;
  if (F && (F.trainedInLeague.includes(id) || F.trainedInFriendly.includes(id))) return 1;
  const t = TRAININGS[hrf.team.trainingType];
  const pos = state.league?.lineup.positions.find((p) => p.playerId === id);
  if (t && pos && trainingFor(pos.role, t) === "teilweise") return 0.5;
  return 0;
}

function startSkills(p: Player) {
  const hist = state.ho?.history.get(p.id);
  return skillsOf(p, hist?.[hist.length - 1]);
}

// --- Darstellung ------------------------------------------------------------------

function render() {
  const hrf = state.hrf;
  $("#empty").hidden = !!hrf;
  $("#app").hidden = !hrf;
  $("#sectionNav").hidden = !hrf;
  if (!hrf) return;
  $("#teamName").textContent = hrf.team.teamName;
  renderDataChip();
  renderHero();
  renderLineup();
  renderWeakness();
  renderDevelopment();
  renderSchedule();
  renderFriendly();
  renderAdvice();
  renderSquad();
}

function renderDataChip() {
  const chip = $("#dataChip");
  const hrf = state.hrf!;
  const hrfDate = new Date(hrf.team.hrfDate.replace(" ", "T"));
  const ageDays = (Date.now() - hrfDate.getTime()) / 864e5;
  const parts = [`HO-Download ${isNaN(hrfDate.getTime()) ? hrf.team.hrfDate : fmtShort(hrfDate)}`];
  if (state.ho) parts.push(`Spielplan ${fmtShort(state.ho.generated)}`);
  else parts.push("ohne Spielplan");
  const stale = ageDays > 7 || !state.ho;
  chip.hidden = false;
  chip.classList.toggle("stale", stale);
  chip.innerHTML = `${stale ? `<span class="status warning"><i>!</i></span>` : ""}${esc(parts.join(" · "))}`;
  chip.title = stale
    ? !state.ho
      ? "TopHatt.bat starten, damit Spielplan und Spielerhistorie aus HO kommen."
      : "Die Daten sind älter als eine Woche. In HO herunterladen und TopHatt.bat starten."
    : `Datei: ${state.hrfName}`;
}

function countdown(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "läuft oder ist vorbei";
  const h = Math.floor(ms / 36e5);
  const days = Math.floor(h / 24);
  return days > 0 ? `in ${days} ${days === 1 ? "Tag" : "Tagen"}, ${h % 24} Std.` : `in ${h} Std.`;
}

function renderHero() {
  const hrf = state.hrf!;
  const m = state.match;
  const L = state.league;
  const teamId = hrf.team.teamId;
  const worst = [...state.weak].sort((a, b) => a.delta - b.delta)[0];
  const stats = L
    ? `<div class="hero-stats">
        <div class="big">${L.hatStats.toFixed(0)}<small>HatStats erwartet</small></div>
        <div class="big" style="font-size:24px">${formationLabel(L.lineup.formation)}<small>Formation</small></div>
        ${worst ? `<div><small class="kicker" style="font-size:11px">Größte Schwachstelle</small><div style="font-size:18px;font-weight:600">${esc(worst.name)} · ${ratingLabel(worst.rating)}</div></div>` : ""}
      </div>`
    : "";
  if (!m) {
    $("#spiel").innerHTML = `
      <div class="kicker">Nächstes Spiel</div>
      <div class="versus"><div class="side us">${esc(hrf.team.teamName)}</div><div class="vs">vs</div><div class="side away">${hrf.lineupMatchId ? `Spiel ${hrf.lineupMatchId}` : "Gegner unbekannt"}</div></div>
      <p class="hero-note">Spielplan und Gegner fehlen noch. Starte <b>TopHatt.bat</b> (holt die Daten aus HO) und klicke dann auf „Aktualisieren“.</p>
      ${stats}
      <div class="hero-actions"><a class="btn primary" href="#aufstellung">Zur Aufstellung</a></div>`;
    return;
  }
  const home = m.homeId === teamId;
  const round = state.ho ? roundOf(state.ho, m.id) : 0;
  const later = state.ho ? upcomingMatches(state.ho).filter((x) => x.id !== m.id).slice(0, 4) : [];
  const opp = (x: HoMatch) => (x.homeId === teamId ? `${x.awayName} (H)` : `${x.homeName} (A)`);
  $("#spiel").innerHTML = `
    <div class="kicker">Nächstes Spiel · ${esc(MATCH_TYPE_DE[m.type] ?? "Spiel")}${round ? ` · ${round}. Spieltag` : ""}</div>
    <div class="versus">
      <div class="side ${home ? "us" : ""}"><small>Heim</small>${esc(m.homeName)}</div>
      <div class="vs">vs</div>
      <div class="side away ${home ? "" : "us"}"><small>Gast</small>${esc(m.awayName)}</div>
    </div>
    <div class="hero-meta">
      <span><b>${fmtDateTime(m.date)}</b></span>
      <span>${countdown(m.date)}</span>
      <span>${home ? "Heimspiel" : m.derby ? "Auswärts-Derby" : "Auswärtsspiel"}</span>
      ${m.weatherForecast >= 0 ? `<span>Wetter-Prognose: ${WEATHER_DE[m.weatherForecast] ?? "?"}</span>` : ""}
      <span>${m.lineupSent ? "Aufstellung ist abgegeben" : "Aufstellung noch nicht abgegeben"}</span>
    </div>
    ${stats}
    <div class="hero-actions">
      <a class="btn primary" href="#aufstellung">Aufstellung ansehen</a>
      <span class="hero-note">Stärke von ${esc(home ? m.awayName : m.homeName)} ist noch nicht bekannt (kommt mit dem Gegnercheck).</span>
    </div>
    ${later.length ? `<div class="next-list">${later.map((x) => `<span class="chip">${fmtDate(x.date)} · ${esc(opp(x))}${x.type === 3 ? " · Pokal" : x.type !== 1 ? " · FS" : ""}</span>`).join("")}</div>` : ""}`;
}

function pitch(lineup: Lineup, highlightTraining = false): string {
  const byId = playersById();
  const t = state.hrf ? TRAININGS[state.hrf.team.trainingType] : undefined;
  const sev = new Map(state.weak.map((w) => [w.sector, w.severity]));
  return `<div class="pitch">${lineup.positions
    .map((pos) => {
      const p = byId.get(pos.playerId);
      const [row, col] = GRID[pos.role];
      const trained = highlightTraining && t && trainingFor(pos.role, t) === "voll";
      const sectors = ROLE_SECTORS[pos.role] ?? [];
      const cls = highlightTraining ? "" : sectors.some((s) => sev.get(s) === "critical") ? "weak" : sectors.some((s) => sev.get(s) === "warning") ? "soft" : "";
      const tags = [
        pos.playerId === lineup.captainId ? `<span class="tag">C</span>` : "",
        pos.playerId === lineup.setPiecesId ? `<span class="tag">St</span>` : "",
        trained ? `<span class="tag train">Training</span>` : "",
      ].join("");
      return `<div class="slot ${cls}" style="grid-row:${row + 1};grid-column:${col + 1}">
        <div class="role">${ROLE_DE[pos.role]}${pos.behaviour ? ` · ${BEHAVIOUR_DE[pos.behaviour]}` : ""}</div>
        <div class="pname"><span class="full">${esc(p?.name ?? "?")}</span><span class="last">${esc((p?.name ?? "?").split(" ").slice(-1)[0])}</span></div>
        <div class="meta">${p ? `Form ${p.form} · Kond. ${p.stamina}` : ""} ${tags}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function renderLineup() {
  const L = state.league;
  if (!L) return;
  const byId = playersById();
  const m = state.match;
  $("#lineupSub").textContent = m ? `für ${fmtDate(m.date)} gegen ${m.homeId === state.hrf!.team.teamId ? m.awayName : m.homeName}` : "";
  $("#pitchOut").innerHTML = pitch(L.lineup) + `<p class="sub">Roter Rand: Spieler in einem schwachen Mannschaftsteil, gelb: leicht unter dem Durchschnitt.</p>`;
  const bench = Object.entries(L.lineup.bench)
    .map(([slot, id]) => `<tr><td class="muted">${BENCH_DE[slot]}</td><td>${esc(byId.get(id!)?.name ?? "-")}</td></tr>`)
    .join("");
  $("#lineupSide").innerHTML = `
    <table><tbody>
      <tr><td class="muted">Formation</td><td><b>${formationLabel(L.lineup.formation)}</b></td></tr>
      <tr><td class="muted">HatStats</td><td><b>${L.hatStats.toFixed(0)}</b> <span class="muted">Ø über 90 Minuten</span></td></tr>
      <tr><td class="muted">Kapitän</td><td>${esc(byId.get(L.lineup.captainId)?.name ?? "-")}</td></tr>
      <tr><td class="muted">Standards</td><td>${esc(byId.get(L.lineup.setPiecesId)?.name ?? "-")}</td></tr>
    </tbody></table>
    <h3>Ersatzbank</h3>
    <table><tbody>${bench}</tbody></table>
    <details><summary>Formationen im Vergleich</summary>
      <table><thead><tr><th>Formation</th><th class="num">Erfahrung</th><th class="num">HatStats</th></tr></thead><tbody>
      ${L.perFormation.map((f) => `<tr><td>${formationLabel(f.formation)}</td><td class="num">${f.experience}</td><td class="num">${f.hatStats.toFixed(0)}</td></tr>`).join("")}
      </tbody></table>
    </details>`;
}

const STATUS_LABEL = { critical: ["!", "Schwach"], warning: ["–", "Ausbaufähig"], good: ["✓", "Solide"], serious: ["↓", ""] } as const;
const statusChip = (cls: "good" | "warning" | "serious" | "critical", label: string, icon: string) => `<span class="status ${cls}"><i>${icon}</i>${esc(label)}</span>`;

function renderWeakness() {
  const W = state.weak;
  if (!W.length) return;
  const max = Math.max(8, ...W.map((w) => w.rating));
  const avg = W.reduce((s, w) => s + w.rating, 0) / W.length;
  const worst = [...W].sort((a, b) => a.delta - b.delta).filter((w) => w.severity !== "good");
  const focus = worst.length
    ? `<div class="focus"><b>Hier verbessern: ${worst.map((w) => esc(w.name)).join(", ")}.</b> ${esc(worst[0].advice)}</div>`
    : `<div class="focus ok"><b>Keine deutliche Schwachstelle.</b> Alle Mannschaftsteile liegen nah am Durchschnitt.</div>`;
  const rows = W.map((w) => {
    const [icon, label] = STATUS_LABEL[w.severity];
    return `<div class="bar-row" title="${esc(ratingLabel(w.rating))}">
      <div class="bar-name">${esc(w.name)}</div>
      <div class="bar-track">
        <div class="bar-fill ${w.severity}" style="width:${((w.rating / max) * 100).toFixed(1)}%"></div>
        <div class="bar-avg" style="left:${((avg / max) * 100).toFixed(1)}%" title="Durchschnitt ${avg.toFixed(2)}"></div>
        <span class="bar-val" style="left:calc(${((w.rating / max) * 100).toFixed(1)}% + 6px)">${w.rating.toFixed(2)}</span>
      </div>
      ${statusChip(w.severity, label, icon)}
      ${w.severity !== "good" ? `<div class="advice">${esc(ratingLabel(w.rating))}. ${esc(w.advice)}</div>` : ""}
    </div>`;
  }).join("");
  $("#weakOut").innerHTML = `${focus}<div class="bars">${rows}</div>
    <p class="sub" style="margin-top:12px">Senkrechter Strich = Durchschnitt (${avg.toFixed(2)}). Das Mittelfeld zählt in den HatStats dreifach und entscheidet über den Ballbesitz, deshalb wird es strenger bewertet.</p>`;
}

// --- Entwicklung ------------------------------------------------------------------

const OUTLOOK_STATUS: Record<string, ["good" | "warning" | "serious" | "critical", string, number]> = {
  "Ersatz planen": ["critical", "!", 0],
  Abbau: ["serious", "↓", 1],
  Höhepunkt: ["warning", "★", 2],
  stabil: ["good", "=", 3],
  wächst: ["good", "↑", 4],
};

function renderDevelopment() {
  const hrf = state.hrf!;
  const setup = state.setup;
  if (!setup) return;
  const t = TRAININGS[setup.type];
  $("#devSub").textContent = `Training: ${t?.name ?? "unbekannt"}, Intensität ${setup.intensity} %, Kondition ${setup.staminaShare} %, Trainer Stufe ${setup.coachLevel}, Assistenten ${setup.assistantsLevel}${state.ho ? "" : " (Trainer und Assistenten geschätzt, TopHatt.bat liefert die echten Werte)"}`;

  const sorted = [...hrf.players].sort((a, b) => {
    const oa = OUTLOOK_STATUS[state.outlooks.get(a.id)!.outlook][2];
    const ob = OUTLOOK_STATUS[state.outlooks.get(b.id)!.outlook][2];
    return oa - ob || b.age - a.age;
  });
  const sel = $<HTMLSelectElement>("#devPlayer");
  if (!hrf.players.some((p) => p.id === state.devPlayer)) state.devPlayer = sorted[0]?.id ?? 0;
  sel.innerHTML = [...hrf.players]
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .map((p) => `<option value="${p.id}" ${p.id === state.devPlayer ? "selected" : ""}>${esc(p.name)} (${p.age})</option>`)
    .join("");
  renderDevChart();

  const rows = sorted
    .map((p) => {
      const o = state.outlooks.get(p.id)!;
      const [cls, icon] = OUTLOOK_STATUS[o.outlook];
      const f = (v: number) => v.toFixed(1).replace(".", ",");
      return `<tr data-player="${p.id}" style="cursor:pointer">
        <td>${esc(p.name)}</td><td class="num">${p.age}</td><td>${DEV_SKILL_DE[o.mainSkill]}</td>
        <td class="num">${f(o.now)}</td><td class="num">${f(o.inOneSeason)}</td><td class="num">${f(o.inTwoSeasons)}</td>
        <td class="num">${o.dropAge}</td>
        <td>${statusChip(cls, o.outlook, icon)}</td>
        <td class="sub" style="white-space:normal;min-width:240px">${esc(o.text)}</td></tr>`;
    })
    .join("");
  $("#outlookOut").innerHTML = `<table class="nowrap"><thead><tr><th>Spieler</th><th class="num">Alter</th><th>Hauptfertigkeit</th><th class="num">Jetzt</th>
    <th class="num">+1 Saison</th><th class="num">+2 Saisons</th><th class="num">Abbau ab</th><th>Ausblick</th><th>Hinweis</th></tr></thead><tbody>${rows}</tbody></table>`;
  $("#outlookOut")
    .querySelectorAll<HTMLTableRowElement>("tr[data-player]")
    .forEach((tr) =>
      tr.addEventListener("click", () => {
        state.devPlayer = Number(tr.dataset.player);
        $<HTMLSelectElement>("#devPlayer").value = String(state.devPlayer);
        renderDevChart();
        $("#entwicklung").scrollIntoView({ behavior: "smooth" });
      }),
    );
}

const SERIES_VARS = ["var(--s1)", "var(--s2)", "var(--s3)"];

function renderDevChart() {
  const hrf = state.hrf!;
  const p = hrf.players.find((x) => x.id === state.devPlayer);
  const setup = state.setup;
  if (!p || !setup) return;
  const skills = mainSkills(p, 3) as DevSkill[];
  const hist = (state.ho?.history.get(p.id) ?? []).filter((h) => !isNaN(h.date.getTime()));
  const start = startSkills(p);
  const base = new Date(hrf.team.hrfDate.replace(" ", "T"));
  const baseTime = isNaN(base.getTime()) ? Date.now() : base.getTime();
  const weeks = 48;
  const proj = project(start, p.age, p.ageDays, setup, trainingShare(p.id), weeks);
  const week = 7 * 864e5;

  type Pt = { t: number; v: Record<string, number>; age: number; ageDays: number; kind: "Historie" | "Prognose" };
  const histPts: Pt[] = hist.map((h) => ({ t: h.date.getTime(), v: h as unknown as Record<string, number>, age: h.age, ageDays: h.ageDays, kind: "Historie" }));
  const projPts: Pt[] = proj.map((pt) => ({ t: baseTime + pt.week * week, v: pt.values, age: pt.age, ageDays: pt.ageDays, kind: "Prognose" }));
  const all = [...histPts, ...projPts];
  const t0 = Math.min(...all.map((x) => x.t));
  const t1 = Math.max(...all.map((x) => x.t));
  const vals = all.flatMap((x) => skills.map((s) => x.v[s]));
  const yMin = Math.max(0, Math.floor(Math.min(...vals)) - 1);
  const yMax = Math.ceil(Math.max(...vals)) + 1;

  const W = 820,
    H = 300,
    ml = 34,
    mr = 120,
    mt = 14,
    mb = 40;
  const X = (t: number) => ml + ((t - t0) / Math.max(1, t1 - t0)) * (W - ml - mr);
  const Y = (v: number) => mt + (1 - (v - yMin) / (yMax - yMin)) * (H - mt - mb);
  const path = (pts: Pt[], s: string) => pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.v[s]).toFixed(1)}`).join("");

  let grid = "";
  for (let v = yMin; v <= yMax; v++) grid += `<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`;
  // Saison-Markierungen mit Alter
  let ticks = "";
  for (let k = 0; k <= weeks; k += 16) {
    const pt = projPts[k];
    const x = X(pt.t);
    ticks += `<line x1="${x}" x2="${x}" y1="${mt}" y2="${H - mb}" stroke="var(--grid)" ${k ? 'stroke-dasharray="3 3"' : ""}/>
      <text x="${x}" y="${H - mb + 16}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${k === 0 ? "heute" : `+${k / 16} Saison${k > 16 ? "s" : ""}`}</text>
      <text x="${x}" y="${H - mb + 30}" text-anchor="middle" font-size="11" fill="var(--muted)">${pt.age} J.</text>`;
  }
  // Endbeschriftungen ohne Überlappung: von oben nach unten mit Mindestabstand
  const labelY = new Map<string, number>();
  {
    const lastPt = projPts[projPts.length - 1];
    const order = [...skills].sort((a, b) => Y(lastPt.v[a]) - Y(lastPt.v[b]));
    let prev = -Infinity;
    for (const s of order) {
      const y = Math.max(Y(lastPt.v[s]), prev + 15);
      labelY.set(s, y);
      prev = y;
    }
  }
  const lines = skills
    .map((s, i) => {
      const col = SERIES_VARS[i];
      const last = projPts[projPts.length - 1];
      const hp = histPts.length ? `<path d="${path([...histPts, projPts[0]], s)}" fill="none" stroke="${col}" stroke-width="2"/>` : "";
      return `${hp}<path d="${path(projPts, s)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>
        ${histPts.map((h) => `<circle cx="${X(h.t)}" cy="${Y(h.v[s])}" r="4" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`).join("")}
        <text x="${X(last.t) + 8}" y="${labelY.get(s)! + 4}" font-size="12" fill="var(--ink)">${DEV_SKILL_DE[s]} ${last.v[s].toFixed(1).replace(".", ",")}</text>`;
    })
    .join("");
  const o = state.outlooks.get(p.id)!;
  $("#devChart").innerHTML = `
    <div class="legend">${skills.map((s, i) => `<span><i style="background:${SERIES_VARS[i]}"></i>${DEV_SKILL_DE[s]}</span>`).join("")}
      <span><i class="dash"></i>Prognose</span>${histPts.length ? `<span><i style="background:var(--muted)"></i>gemessen (HO)</span>` : ""}</div>
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fertigkeiten von ${esc(p.name)} über die Zeit">${grid}${ticks}${lines}
        <line class="cross" x1="0" x2="0" y1="${mt}" y2="${H - mb}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>
        <rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" fill="transparent" class="hit"/></svg>
      <div class="tip" hidden></div>
    </div>
    <p class="sub">${esc(p.name)}, ${p.age} Jahre: ${esc(o.text)} ${trainingShare(p.id) === 1 ? "Bekommt diese Woche volles Training." : trainingShare(p.id) > 0 ? "Bekommt Teiltraining." : "Bekommt mit dem aktuellen Plan kein Training seiner Trainingsfertigkeit."}
    ${histPts.length < 3 ? " Gemessene Werte kommen mit jedem wöchentlichen HO-Download dazu." : ""}</p>`;

  const svg = $("#devChart").querySelector("svg")!;
  const tip = $("#devChart").querySelector<HTMLElement>(".tip")!;
  const cross = svg.querySelector<SVGLineElement>(".cross")!;
  svg.querySelector(".hit")!.addEventListener("mousemove", (ev) => {
    const e = ev as MouseEvent;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = all[0];
    for (const pt of all) if (Math.abs(X(pt.t) - x) < Math.abs(X(best.t) - x)) best = pt;
    const cx = X(best.t);
    cross.setAttribute("x1", String(cx));
    cross.setAttribute("x2", String(cx));
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>${new Date(best.t).toLocaleDateString("de-DE")}</b> · ${best.age} J. ${best.ageDays} T.<br><span class="muted">${best.kind}</span><br>${skills
      .map((s, i) => `<span style="color:${SERIES_VARS[i]}">●</span> ${DEV_SKILL_DE[s]}: ${best.v[s].toFixed(2).replace(".", ",")} <span class="muted">(${ratingLabel(best.v[s]).split(" (")[0]})</span>`)
      .join("<br>")}`;
    const px = (cx / W) * r.width;
    tip.style.left = `${Math.min(r.width - 190, Math.max(0, px + 12))}px`;
    tip.style.top = "8px";
  });
  svg.querySelector(".hit")!.addEventListener("mouseleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  });
}

// --- Spielplan, Freundschaftsspiel, Transfers, Kader ------------------------------------

function renderSchedule() {
  const ho = state.ho;
  const teamId = state.hrf!.team.teamId;
  if (!ho || !ho.currentLeague) {
    $("#leagueSub").textContent = "";
    $("#fixturesOut").innerHTML = `<p class="muted">Der Spielplan kommt aus HO. Starte TopHatt.bat und klicke auf „Aktualisieren“.</p>`;
    $("#tableOut").innerHTML = "";
    return;
  }
  const lg = ho.currentLeague;
  $("#leagueSub").textContent = `Liga ${lg.name}, Saison ${lg.season}`;
  const own = ho.fixtures.filter((f) => f.leagueId === lg.id && f.season === lg.season && (f.homeId === teamId || f.awayId === teamId)).sort((a, b) => a.round - b.round);
  const nextId = state.match?.id;
  $("#fixturesOut").innerHTML = `<h3 style="margin-top:0">Unsere Spiele</h3><div class="scroll"><table class="nowrap"><thead><tr><th class="num">Tag</th><th>Datum</th><th>Gegner</th><th></th><th class="num">Ergebnis</th></tr></thead><tbody>
    ${own
      .map((f) => {
        const home = f.homeId === teamId;
        const played = f.homeGoals >= 0;
        const our = home ? f.homeGoals : f.awayGoals;
        const their = home ? f.awayGoals : f.homeGoals;
        const res = played ? `${our}:${their} ${our > their ? statusChip("good", "S", "✓") : our < their ? statusChip("critical", "N", "✕") : statusChip("warning", "U", "=")}` : "";
        return `<tr class="${f.matchId === nextId ? "me" : ""}"><td class="num">${f.round}</td><td>${fmtDate(f.date)}</td><td>${esc(home ? f.awayName : f.homeName)}</td><td class="muted">${home ? "Heim" : "Auswärts"}</td><td class="num">${res}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  const table = standings(ho);
  $("#tableOut").innerHTML = `<h3 style="margin-top:0">Tabelle</h3><div class="scroll"><table class="nowrap"><thead><tr><th class="num">Pl.</th><th>Team</th><th class="num">Sp.</th><th class="num">Tore</th><th class="num">Pkt.</th></tr></thead><tbody>
    ${table
      .map(
        (r) =>
          `<tr class="${r.teamId === teamId ? "me" : ""} ${r.position === 1 ? "promo" : ""}"><td class="num">${r.position}</td><td>${esc(r.name)}</td><td class="num">${r.played}</td><td class="num">${r.goalsFor}:${r.goalsAgainst}</td><td class="num">${r.points}</td></tr>`,
      )
      .join("")}</tbody></table></div>
    <p class="sub">Grüner Rand: Aufstiegsplatz. Tabelle aus den Ergebnissen, die HO kennt.</p>`;
}

function renderFriendly() {
  const F = state.friendly;
  const hrf = state.hrf!;
  const t = TRAININGS[hrf.team.trainingType];
  if (!F || !t) return;
  const byId = playersById();
  const names = (ids: number[]) => ids.map((id) => esc(byId.get(id)?.name ?? "")).join(", ") || "–";
  const cupWeek = state.ho ? upcomingMatches(state.ho).some((m) => m.type === 3 && m.date.getTime() - Date.now() < 7 * 864e5) : false;
  $("#friendlyOut").innerHTML = `
    ${cupWeek ? `<div class="focus">Diese Woche steht ein Pokalspiel an. Freundschaftsspiele gehen nur in Wochen ohne Pokalspiel.</div>` : ""}
    <div class="grid2">
      <div>${pitch(F.lineup, true)}</div>
      <div>
        <p><b>Formation ${formationLabel(F.lineup.formation)}</b> für Training „${esc(t.name)}“</p>
        <ul>${F.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        <h3>Volles Training diese Woche</h3><p>${names([...F.trainedInLeague, ...F.trainedInFriendly])}</p>
        <h3>Ohne Training</h3><p>${names(F.untrained)}</p>
      </div>
    </div>`;
}

function renderAdvice() {
  const A = state.advice;
  if (!A) return;
  $("#adviceOut").innerHTML = `
    ${A.summary.map((s) => `<p class="focus ok">${esc(s)}</p>`).join("")}
    <h3>Wo eine Verstärkung am meisten bringt</h3>
    <div class="scroll"><table class="nowrap"><thead><tr><th>Position</th><th>Fertigkeit</th><th>Spielt jetzt</th><th class="num">+1 Stufe</th><th class="num">+2 Stufen</th></tr></thead><tbody>
    ${A.upgrades.map((u) => `<tr><td>${u.position}</td><td>${u.skill}</td><td>${esc(u.currentPlayer)}</td><td class="num">+${u.gainPlus1.toFixed(1)}</td><td class="num">+${u.gainPlus2.toFixed(1)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="sub">Zuwachs an HatStats, wenn auf dieser Position ein sonst gleicher Spieler mit höherer Fertigkeit stünde. Gekaufte Spieler haben anfangs keine Treue, sie brauchen deshalb etwa eine Stufe mehr.</p>
    <h3>Verkauf prüfen</h3>
    <ul>${A.sellCandidates.map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.reason)}</li>`).join("") || "<li>Niemand auffällig.</li>"}</ul>
    <h3>Trainingskandidaten</h3>
    <ul>${A.trainingTargets.map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.reason)}</li>`).join("")}</ul>`;
}

function bestPosition(p: Player): { role: number; value: number } {
  let best = { role: Role.keeper as number, value: -1 };
  for (const role of [Role.keeper, Role.leftBack, Role.leftCentralDefender, Role.leftWinger, Role.leftInnerMidfield, Role.centralForward]) {
    const v = playerPositionRating(p, role);
    if (v > best.value) best = { role, value: v };
  }
  return best;
}

function renderSquad() {
  const hrf = state.hrf!;
  const t = TRAININGS[hrf.team.trainingType];
  const inLeague = new Set(state.league?.lineup.positions.map((p) => p.playerId) ?? []);
  const inFriendly = new Set(state.friendly?.lineup.positions.map((p) => p.playerId) ?? []);
  const onBench = new Set(Object.values(state.league?.lineup.bench ?? {}));
  const rows = [...hrf.players]
    .map((p) => ({ p, best: bestPosition(p) }))
    .sort((a, b) => b.best.value - a.best.value)
    .map(({ p, best }) => {
      const status = [
        p.injury > 0 ? statusChip("critical", `verletzt ${p.injury} W.`, "+") : p.injury === 0 ? statusChip("warning", "angeschlagen", "!") : "",
        p.cards > 0 ? statusChip("warning", `${p.cards}× Gelb`, "!") : "",
      ].join(" ");
      const role = inLeague.has(p.id) ? "Liga" : onBench.has(p.id) ? "Bank" : "";
      const friendly = inFriendly.has(p.id) ? "FS" : "";
      return `<tr>
        <td>${esc(p.name)}</td><td class="num">${p.age}</td>
        <td class="num">${p.keeper}</td><td class="num">${p.defending}</td><td class="num">${p.playmaking}</td><td class="num">${p.winger}</td>
        <td class="num">${p.passing}</td><td class="num">${p.scoring}</td><td class="num">${p.setPieces}</td>
        <td class="num">${p.form}</td><td class="num">${p.stamina}</td><td class="num">${p.experience}</td>
        <td>${SPECIALTY_DE[p.specialty] ?? ""}</td>
        <td>${SECTOR_NAME[lineupSector(best.role)]} <span class="muted">${best.value.toFixed(1)}</span></td>
        <td class="num">${t ? trainingPriority(p, t).toFixed(1) : ""}</td>
        <td>${[role, friendly].filter(Boolean).join(" + ")}</td>
        <td>${status}</td>
        <td class="num">${Math.round(p.salary).toLocaleString("de-DE")} €</td>
      </tr>`;
    })
    .join("");
  $("#squadOut").innerHTML = `<div class="scroll"><table class="nowrap"><thead><tr>
    <th>Name</th><th class="num">Alter</th><th class="num">TW</th><th class="num">VE</th><th class="num">SA</th><th class="num">FL</th>
    <th class="num">PS</th><th class="num">TS</th><th class="num">ST</th><th class="num">Form</th><th class="num">Kond.</th><th class="num">Erf.</th>
    <th>Spezialität</th><th>Beste Position</th><th class="num">Trainings-Prio</th><th>Einsatz</th><th>Status</th><th class="num">Gehalt</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// --- HRF für HO speichern --------------------------------------------------------------

function download(lineup: Lineup, kind: "liga" | "freundschaft") {
  if (!state.hrf) return;
  const idInput = $<HTMLInputElement>(kind === "liga" ? "#matchId" : "#friendlyMatchId");
  const matchId = Number(idInput.value);
  if (!matchId) {
    $("#error").textContent = "Bitte zuerst die Spiel-ID eintragen (steht in HO bei „Spiel auswählen“ bzw. auf hattrick.org in der Spieladresse).";
    idInput.focus();
    return;
  }
  // HO-Spieltypen: 1 = Liga, 3 = Pokal, 4 = Freundschaftsspiel
  const matchType = kind === "liga" ? Number($<HTMLSelectElement>("#matchType").value) : 4;
  const text = writeLineupToHrf(state.hrf, lineup, matchId, matchType);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.hrf.team.teamId}-${state.hrf.team.hrfDate.slice(0, 10)}-${kind}.hrf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Ordner und Einstellungen ------------------------------------------------------------

function openSettings() {
  $<HTMLDialogElement>("#settings").showModal();
}

async function connect() {
  try {
    state.folder = await chooseFolder();
    $<HTMLButtonElement>("#connectFolder").textContent = "Anderen Ordner wählen …";
    await loadFromFolder(state.folder);
    $<HTMLDialogElement>("#settings").close();
  } catch (e) {
    if ((e as Error).name !== "AbortError") $("#error").textContent = (e as Error).message;
  }
}

async function initFolder() {
  if (!folderApiAvailable()) {
    $<HTMLButtonElement>("#connectFolder").hidden = true;
    $<HTMLButtonElement>("#connectEmpty").hidden = true;
    $("#folderStatus").textContent = "Dieser Browser kann keine Ordner verbinden (geht in Chrome und Edge). Datei unten auswählen.";
    $("#emptyStatus").textContent = "Ordner verbinden geht nur in Chrome oder Edge.";
    return;
  }
  const h = await storedFolder();
  if (!h) return;
  state.folder = h;
  $<HTMLButtonElement>("#connectFolder").textContent = "Anderen Ordner wählen …";
  try {
    if (await hasPermission(h)) await loadFromFolder(h);
    else {
      const msg = `Ordner „${h.name}“ ist verbunden. Klick auf „Aktualisieren“, der Browser fragt einmal nach dem Zugriff.`;
      $("#folderStatus").textContent = msg;
      $("#emptyStatus").textContent = msg;
      $<HTMLButtonElement>("#connectEmpty").textContent = "Daten laden";
      $<HTMLButtonElement>("#connectEmpty").onclick = refresh;
    }
  } catch {
    $("#folderStatus").textContent = `Ordner „${h.name}“ ist nicht mehr erreichbar. Bitte neu verbinden.`;
  }
}

function init() {
  const input = $<HTMLInputElement>("#file");
  input.addEventListener("change", () => input.files && loadFiles(Array.from(input.files)).then(() => $<HTMLDialogElement>("#settings").close()));
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) loadFiles(files).then(() => $<HTMLDialogElement>("#settings").close());
  });
  $("#connectFolder").addEventListener("click", connect);
  $("#connectEmpty").onclick = connect;
  $("#pickFileEmpty").addEventListener("click", (e) => {
    e.preventDefault();
    input.click();
  });
  $("#refresh").addEventListener("click", refresh);
  $("#openSettings").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", () => $<HTMLDialogElement>("#settings").close());
  for (const id of ["#location", "#tactic", "#attitude", "#style", "#minExp", "#bruised", "#behaviours"]) $(id).addEventListener("change", compute);
  $("#devPlayer").addEventListener("change", () => {
    state.devPlayer = Number($<HTMLSelectElement>("#devPlayer").value);
    renderDevChart();
  });
  $("#dlLeague").addEventListener("click", () => state.league && download(state.league.lineup, "liga"));
  $("#dlFriendly").addEventListener("click", () => state.friendly && download(state.friendly.lineup, "freundschaft"));
  // Countdown und Datenstand jede Minute auffrischen
  setInterval(() => state.hrf && (renderHero(), renderDataChip()), 60_000);
  initFolder();
}

init();
