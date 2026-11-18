// TopHatt-Oberfläche: eine einzige HTML-Seite, läuft offline im Browser. Keine Daten verlassen den Rechner.

import { DATA_FILE, type DirHandle, askPermission, chooseFolder, fileByName, folderApiAvailable, hasPermission, newestFile, storedFolder } from "./folder";
import { parseHrf, writeLineupToHrf } from "../core/hrf";
import { Attitude, Location, Role, Tactic, type Hrf, type Lineup, type MatchSettings, type Player } from "../core/model";
import { HATSTATS_OBJECTIVE, formationLabel, hatStatsOf, optimizeLineup, type OptimizeResult } from "../core/optimizer";
import { RATING_SECTORS, type RatingSector, type SectorRatings, lineupSector, playerPositionRating, ratingLabel } from "../core/rating";
import { TRAININGS, planFriendly, trainingFor, trainingPriority, type FriendlyPlan } from "../core/training";
import { advise, type Advice } from "../core/advisor";
import { type HoData, type HoMatch, MATCH_TYPE_DE, WEATHER_DE, parseHoData, roundOf, standings, upcomingMatches } from "../core/hodata";
import { DEV_SKILL_DE, type DevSkill, type PlayerOutlook, type TrainingSetup, mainSkills, outlookFor, project, skillsOf } from "../core/development";
import { type SectorAssessment, assessSectors } from "../core/weakness";
import { TACTIC_DE, type OpponentProfile, duels, opponentProfile, verdict } from "../core/opponent";
import { type GroupPlan, GROUP_SHORT, fitTable, planSquad, squadGroups } from "../core/squad";
import { completeLineup, evaluatePositions, explain, formationCode, lineupProblems, roleShort } from "../core/editor";
import { FORMATIONS, behavioursFor } from "../core/optimizer";
import { centralShare, loddarStats, settingsEffect, tacticLevel } from "../core/tactics";
import { Behaviour, type FieldPosition } from "../core/model";
import { type SearchProfile, budget, searchProfiles } from "../core/scouting";

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
  opponent: OpponentProfile | null;
  /** Aufstellung im Editor (manuell oder automatisch) */
  manual: FieldPosition[];
  manualEdited: boolean;
  pick: { kind: "pool"; id: number } | { kind: "slot"; role: number } | null;
  /** gewählte Formation im Editor ("" = beste) und die beste Aufstellung je Formation */
  formation: string;
  formations: { code: string; hatStats: number; experience: number; positions: FieldPosition[]; ratings: SectorRatings }[];
  /** Grundlage der Schwachstellen: "mine" (Aufstellungsseite), "auto" oder ein Formationscode */
  weakBasis: string;
  /** Spieler, für den die Linien zu passenden Positionen gezeigt werden */
  flowPid: number | null;
  plans: GroupPlan[];
  profiles: SearchProfile[];
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
  opponent: null,
  manual: [],
  manualEdited: false,
  pick: null,
  formation: "",
  formations: [],
  weakBasis: "mine",
  flowPid: null,
  plans: [],
  profiles: [],
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
    state.manualEdited = false;
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

/**
 * Training für die Prognose. Maßgeblich ist das aktuelle Training aus dem HO-Download (HRF). Ein Wochenplan
 * aus HO zählt nur, wenn er dort von Hand eingetragen wurde; die von HO geschätzten Wochen bleiben auf dem
 * Stand, an dem sie angelegt wurden, und würden ein umgestelltes Training überdecken.
 */
function trainingSetup(): TrainingSetup {
  const hrf = state.hrf!;
  const ho = state.ho;
  const manual = ho?.futureTraining.find((t) => t.type >= 0 && t.source === 2);
  const measured = [...(ho?.training ?? [])].reverse().find((t) => t.type >= 0 && t.source === 1 && t.coachLevel > 0);
  return {
    type: manual?.type ?? hrf.team.trainingType,
    intensity: manual?.intensity || hrf.team.trainingLevel || 100,
    staminaShare: manual?.staminaShare ?? hrf.team.staminaTrainingPart ?? 15,
    coachLevel: measured?.coachLevel || 6,
    assistantsLevel: hrf.team.assistantsLevel >= 0 ? hrf.team.assistantsLevel : (measured?.assistantsLevel ?? 0),
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
    state.formations = [];
    if (state.formation) state.formations.push(...bestPerFormation([state.formation]));
    scheduleFormations();
    if (!state.manualEdited) state.manual = formationPositions();
    state.friendly = planFriendly(hrf.players, state.league.lineup, hrf.team.trainingType, $<HTMLInputElement>("#bruised").checked);
    state.advice = advise(hrf.players, state.league.lineup, state.settings, team, hrf.team.trainingType);
    state.weak = assessSectors(hrf.players, state.league.lineup, state.league.ratings, state.settings, team);
    state.setup = trainingSetup();
    state.outlooks = new Map(hrf.players.map((p) => [p.id, outlookFor(p, startSkills(p), state.setup!, trainingShare(p.id))]));
    state.plans = planSquad(hrf.players, state.league.lineup, (p) => project(startSkills(p), p.age, p.ageDays, state.setup!, trainingShare(p.id), 32));
    state.profiles = searchProfiles(hrf.players, state.weak, state.plans);
    const m = state.match;
    state.opponent = m && state.ho ? opponentProfile(state.ho.matchRatings, m.homeId === hrf.team.teamId ? m.awayId : m.homeId) : null;
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
  $("#sideNav").hidden = !hrf;
  $("#menuBtn").hidden = !hrf;
  document.querySelector(".layout")!.classList.toggle("noapp", !hrf);
  if (!hrf) return;
  $("#teamName").textContent = hrf.team.teamName;
  renderDataChip();
  renderHero();
  renderTiles();
  renderOpponent();
  renderLineup();
  renderDevelopment();
  renderPlan();
  renderSchedule();
  renderFriendly();
  renderAdvice();
  renderSquad();
  renderGroups();
  route();
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
      <a class="btn" href="#gegner">Gegner-Check</a>
      <span class="hero-note">${heroOpponentNote(home ? m.awayName : m.homeName)}</span>
    </div>
    ${later.length ? `<div class="next-list">${later.map((x) => `<span class="chip">${fmtDate(x.date)} · ${esc(opp(x))}${x.type === 3 ? " · Pokal" : x.type !== 1 ? " · FS" : ""}</span>`).join("")}</div>` : ""}`;
}

/** Anteil der Angriffe durch die Mitte mit der gewählten Taktik (für den Gegner-Check) */
function attackCentral(): number {
  const byId = playersById();
  const field = state.manual.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role }));
  const c = centralShare(state.settings.tactic, tacticLevel(field, state.settings.tactic));
  // auf drei Angriffswege umrechnen: normal 37 % Mitte entspricht einer gleichmäßigen Verteilung
  return (c / 0.37) * (1 / 3);
}

function heroOpponentNote(name: string): string {
  const O = state.opponent;
  if (!O || !state.league) return `Stärke von ${esc(name)} ist noch nicht bekannt. In HO den Gegnercheck machen und TopHatt.bat starten.`;
  const v = verdict(duels(state.league.ratings, O.average), attackCentral());
  return `Gegen ${esc(name)}: <b>${esc(v.text)}</b> (aus ${O.matches.length} Spielen des Gegners).`;
}

function renderOpponent() {
  const m = state.match;
  const L = state.league;
  const O = state.opponent;
  const teamId = state.hrf!.team.teamId;
  const name = m ? (m.homeId === teamId ? m.awayName : m.homeName) : "";
  $("#oppSub").textContent = name ? `${name} · Bewertungen aus den letzten Pflichtspielen` : "";
  if (!m || !L) {
    $("#oppOut").innerHTML = `<p class="sub">Kein anstehendes Spiel bekannt.</p>`;
    return;
  }
  if (!O) {
    $("#oppOut").innerHTML = `<div class="focus"><b>Noch keine Spiele von ${esc(name)} in HO.</b> In HO unter „Gegnercheck“ die letzten Spiele des Gegners herunterladen, dann TopHatt.bat starten und „Aktualisieren“ klicken.</div>`;
    return;
  }
  const D = duels(L.ratings, O.average);
  const v = verdict(D, attackCentral());
  const cls = v.edge > 0.52 ? "ok" : "";
  const row = (d: (typeof D)[number]) => `<div class="duel" title="${esc(ratingLabel(d.ours))} gegen ${esc(ratingLabel(d.theirs))}">
      <div class="dl">${esc(d.label)}</div>
      <div class="dv">${d.ours.toFixed(2)}</div>
      <div class="split" aria-label="${Math.round(d.share * 100)} % für uns"><div class="us" style="width:${(d.share * 100).toFixed(1)}%"></div><div class="them" style="flex:1"></div></div>
      <div class="dv">${d.theirs.toFixed(2)}</div>
    </div>`;
  const bestAttack = [...D.slice(1, 4)].sort((a, b) => b.share - a.share)[0];
  const danger = [...D.slice(4)].sort((a, b) => a.share - b.share)[0];
  $("#oppOut").innerHTML = `
    <div class="focus ${cls}"><b>Einschätzung: ${esc(v.text)}.</b> Ballbesitz etwa ${Math.round(D[0].share * 100)} %. Bester Angriffsweg: ${esc(bestAttack.label.replace("Unser Angriff ", ""))}. Größte Gefahr: ${esc(danger.label)}.</div>
    <div class="grid2">
      <div>
        <div class="legend"><span><i style="background:var(--s1)"></i>Wir (erwartet)</span><span><i style="background:var(--s2)"></i>${esc(name)} (Ø)</span></div>
        ${row(D[0])}<h3>Unser Angriff</h3>${D.slice(1, 4).map(row).join("")}<h3>Unsere Abwehr</h3>${D.slice(4).map(row).join("")}
        <p class="sub">Balken = unser Anteil im direkten Duell, Mitte = ausgeglichen. Ballbesitz nach Mittelfeld³, Chancen vereinfacht nach Angriff/(Angriff+Abwehr). Keine Spielsimulation.</p>
      </div>
      <div>
        <table><tbody>
          <tr><td class="muted">Formation meist</td><td><b>${esc(O.formation || "?")}</b></td></tr>
          <tr><td class="muted">Taktik meist</td><td><b>${esc(TACTIC_DE[O.tactic] ?? String(O.tactic))}</b></td></tr>
          <tr><td class="muted">HatStats Ø</td><td><b>${(4 * (3 * O.average.midfield + O.average.defenceLeft + O.average.defenceCentral + O.average.defenceRight + O.average.attackLeft + O.average.attackCentral + O.average.attackRight)).toFixed(0)}</b> <span class="muted">wir: ${L.hatStats.toFixed(0)}</span></td></tr>
        </tbody></table>
        <h3>Ausgewertete Spiele</h3>
        <div class="scroll"><table class="nowrap"><thead><tr><th>Datum</th><th>Gegner</th><th class="num">Ergebnis</th><th>Formation</th><th class="num">Mittelfeld</th></tr></thead><tbody>
        ${O.matches.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.opponentName)}${x.home ? " (H)" : " (A)"}</td><td class="num">${x.goalsFor}:${x.goalsAgainst}</td><td>${esc(x.formation)}</td><td class="num">${x.ratings.midfield.toFixed(2)}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
    </div>`;
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

// --- Aufstellungs-Editor -------------------------------------------------------------

const unavailable = (p: Player) => p.injury > 0 || p.cards >= 3;

/** Beste Elf je Formation (für die Formationsauswahl) */
function bestPerFormation(codes: readonly string[]) {
  const hrf = state.hrf!;
  const out: State["formations"] = [];
  for (const f of codes) {
    try {
      const r = optimizeLineup(hrf.players, state.settings, teamState(), {
        minFormationExperience: 0,
        formationExperience: hrf.team.formationExperience,
        objective: HATSTATS_OBJECTIVE,
        allowBruised: $<HTMLInputElement>("#bruised").checked,
        tryBehaviours: false,
        formations: [f],
      });
      out.push({ code: f, hatStats: r.hatStats, experience: hrf.team.formationExperience[f] ?? 0, positions: r.lineup.positions, ratings: r.ratings });
    } catch {
      /* zu wenige Spieler für diese Formation */
    }
  }
  return out;
}

let formationTimer = 0;
/** Alle Formationen im Hintergrund rechnen, damit die Seite sofort reagiert */
function scheduleFormations() {
  clearTimeout(formationTimer);
  formationTimer = window.setTimeout(() => {
    if (!state.hrf) return;
    state.formations = bestPerFormation(FORMATIONS);
    renderFormationPick();
    renderWeakness();
  }, 30);
}

/** Aufstellung für die gewählte Formation (oder die beste) */
function formationPositions(): FieldPosition[] {
  const f = state.formations.find((x) => x.code === state.formation);
  return (f ? f.positions : state.league!.lineup.positions).map((p) => ({ ...p }));
}

function renderFormationPick() {
  const sel = $<HTMLSelectElement>("#formationPick");
  const best = state.league?.lineup.formation;
  sel.innerHTML =
    `<option value="">Beste${best ? `: ${formationLabel(best)}` : ""} (automatisch)</option>` +
    [...state.formations]
      .sort((a, b) => b.hatStats - a.hatStats)
      .map((f) => `<option value="${f.code}"${f.code === state.formation ? " selected" : ""}>${formationLabel(f.code)} · ${f.hatStats.toFixed(0)} HatStats · Erfahrung ${f.experience}${f.experience < 6 ? " ⚠" : ""}</option>`)
      .join("");
  sel.value = state.formation;
}

function manualEval() {
  return evaluatePositions(state.manual, playersById(), state.settings, teamState());
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
};

const FIELD_LINES = `<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <rect x="2" y="1.5" width="96" height="97" rx="0.5"/>
  <path d="M2 1.5 H98"/><path d="M38 1.5 A12 9 0 0 0 62 1.5"/><circle class="dot" cx="50" cy="1.5" r="0.7"/>
  <rect x="22" y="80" width="56" height="18.5"/><rect x="36" y="91.5" width="28" height="7"/>
  <path d="M40 80 A11 6 0 0 1 60 80"/><circle class="dot" cx="50" cy="87.5" r="0.6"/>
  <path d="M44 98.5 v1.2 h12 v-1.2"/>
</svg>`;

function editPitch(): string {
  const byId = playersById();
  const L = state.league!;
  const C = completeLineup(state.manual, state.hrf!.players, state.settings, $<HTMLInputElement>("#bruised").checked);
  const fit = fitTable(state.hrf!.players);
  const pick = state.pick;
  const slots = Object.entries(GRID).map(([r, [row, col]]) => {
    const role = Number(r);
    const pos = state.manual.find((x) => x.role === role);
    const style = `grid-row:${row + 1};grid-column:${col + 1}`;
    const picked = pick?.kind === "slot" && pick.role === role ? " picked" : "";
    if (!pos) return `<div class="slot empty${picked}" data-role="${role}" style="${style}"><div class="role">${ROLE_DE[role]}</div><div class="token">+</div><div class="pname">frei</div></div>`;
    const p = byId.get(pos.playerId);
    const auto = L.lineup.positions.find((x) => x.role === role);
    const changed = !auto || auto.playerId !== pos.playerId || auto.behaviour !== pos.behaviour;
    const opts = behavioursFor(role);
    const tags = [pos.playerId === C.captainId ? `<span class="tag">C</span>` : "", pos.playerId === C.setPiecesId ? `<span class="tag">St</span>` : "", changed ? `<span class="tag train">neu</span>` : ""].join("");
    const warn = p && (p.injury === 0 || p.cards === 2 || p.stamina <= 5);
    const g = lineupSector(role);
    let fc = "fit-good";
    if (p) {
      const home = fit.home(p);
      const gap = fit.rel(p, home) - fit.rel(p, g);
      fc = home === g || gap < 0.1 ? "fit-good" : gap < 0.25 ? "fit-mid" : "fit-bad";
    }
    const ratingTitle = p ? `${p.name}: Positionsstärke ${playerPositionRating(p, role, pos.behaviour).toFixed(2)}, Form ${p.form}, Kondition ${p.stamina}${fc === "fit-good" ? "" : fc === "fit-mid" ? " · nicht ganz seine Position" : " · falsche Position"}` : "";
    return `<div class="slot${picked}" draggable="true" data-role="${role}" data-pid="${pos.playerId}" style="${style}" title="${esc(ratingTitle)}">
      <button class="x" data-remove="${role}" title="Vom Feld nehmen" aria-label="Vom Feld nehmen">×</button>
      <div class="role">${ROLE_DE[role]}${pos.behaviour ? ` · ${BEHAVIOUR_DE[pos.behaviour]}` : ""}</div>
      <div class="token ${role === Role.keeper ? "gk " : ""}${fc}">${esc(initials(p?.name ?? "?"))}${p ? `<span class="stat">${playerPositionRating(p, role, pos.behaviour).toFixed(1)}</span>` : ""}${warn ? `<span class="warn">!</span>` : ""}</div>
      <div class="pname">${esc((p?.name ?? "?").split(" ").slice(-1)[0])}</div>
      <div class="meta">Form ${p?.form ?? "-"} · Kond. ${p?.stamina ?? "-"} ${tags}</div>
      ${opts.length > 1 ? `<select data-behaviour="${role}" aria-label="Verhalten">${opts.map((b) => `<option value="${b}"${b === pos.behaviour ? " selected" : ""}>${BEHAVIOUR_DE[b] || "normal"}</option>`).join("")}</select>` : ""}
    </div>`;
  });
  const mine = manualEval();
  return `<div class="field">${FIELD_LINES}<div class="pitch edit">${slots.join("")}</div>
    <div class="stats-strip"><span>${formationLabel(formationCode(state.manual))}</span><span><b>${mine.hatStats.toFixed(0)}</b> HatStats</span><span>${state.manual.length}/11</span></div></div>
    <p class="sub">Ring um das Trikot: grün = passende Position, gelb = geht, rot = falsche Position. Zahl = Positionsstärke.</p>`;
}

// --- Animation (FLIP): Spieler gleiten an ihre neue Position -----------------------------

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function tokenRects(): Map<number, DOMRect> {
  const m = new Map<number, DOMRect>();
  document.querySelectorAll<HTMLElement>("#pitchOut .slot[data-pid]").forEach((el) => {
    const t = el.querySelector(".token");
    if (t) m.set(Number(el.dataset.pid), t.getBoundingClientRect());
  });
  document.querySelectorAll<HTMLElement>("#poolOut .pchip[data-pid]").forEach((el) => {
    if (!m.has(Number(el.dataset.pid))) m.set(Number(el.dataset.pid), el.getBoundingClientRect());
  });
  return m;
}

function animateTokens(prev: Map<number, DOMRect>) {
  if (reducedMotion() || !prev.size) return;
  document.querySelectorAll<HTMLElement>("#pitchOut .slot[data-pid]").forEach((el) => {
    const t = el.querySelector<HTMLElement>(".token");
    if (!t) return;
    const before = prev.get(Number(el.dataset.pid));
    const now = t.getBoundingClientRect();
    if (!before) {
      t.classList.add("pop");
      return;
    }
    const dx = before.left + before.width / 2 - (now.left + now.width / 2);
    const dy = before.top + before.height / 2 - (now.top + now.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    t.animate?.([{ transform: `translate(${dx}px, ${dy}px) scale(1.1)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}

/** Einlaufen: Spieler laufen beim Öffnen der Seite von unten aufs Feld */
function kickoffAnimation() {
  if (reducedMotion()) return;
  document.querySelectorAll<HTMLElement>("#pitchOut .slot[data-pid] .token").forEach((t, i) => {
    t.animate?.([{ transform: "translateY(70px) scale(.5)", opacity: 0 }, { transform: "none", opacity: 1 }], {
      duration: 520,
      delay: 40 * i,
      easing: "cubic-bezier(.2,.9,.3,1.2)",
      fill: "backwards",
    });
  });
}

// --- Linien vom gewählten Spieler zu seinen passenden Positionen --------------------------

/** Linien bis 70 % der besten Eignung; Farbe nach Abstand zur besten Position */
const FLOW_CUT = 0.7;
function flowClass(share: number): string {
  if (share >= 0.97) return "fq1"; // optimal (grün)
  if (share >= 0.88) return "fq2"; // gut (gelb)
  if (share >= 0.79) return "fq3"; // mäßig (rot)
  return "fq4"; // Notlösung (grau)
}

/** Linien ausblenden und Auswahl aufheben */
function clearFlow() {
  state.flowPid = null;
  if (state.pick) {
    state.pick = null;
    renderLineup();
  } else drawFlow();
}

function drawFlow() {
  const ed = document.querySelector<HTMLElement>("#aufstellung .editor");
  if (!ed) return;
  ed.querySelector("svg.flow")?.remove();
  ed.querySelectorAll(".flow-target").forEach((x) => x.classList.remove("flow-target"));
  const pick = state.pick;
  const pid = state.flowPid ?? (pick?.kind === "pool" ? pick.id : pick?.kind === "slot" ? (state.manual.find((x) => x.role === pick.role)?.playerId ?? null) : null);
  if (!pid || !state.hrf || ed.offsetParent === null) return;
  const p = playersById().get(pid);
  if (!p) return;
  const fromSlot = state.manual.find((x) => x.playerId === pid);
  const srcEl = fromSlot
    ? ed.querySelector<HTMLElement>(`#pitchOut .slot[data-pid="${pid}"] .token`)
    : ed.querySelector<HTMLElement>(`#poolOut .pchip[data-pid="${pid}"]`);
  if (!srcEl) return;
  const fit = fitTable(state.hrf.players);
  const groups = [...new Set(Object.keys(GRID).map((r) => lineupSector(Number(r))))];
  const best = Math.max(...groups.map((g) => fit.rel(p, g)));
  const cut = best * FLOW_CUT;
  const cands = Object.keys(GRID)
    .map(Number)
    .filter((role) => role !== fromSlot?.role)
    .map((role) => ({ role, rel: fit.rel(p, lineupSector(role)) }))
    .filter((c) => c.rel >= cut)
    .sort((a, b) => b.rel - a.rel)
    .slice(0, 9);
  if (!cands.length) return;
  const box = ed.getBoundingClientRect();
  const sr = srcEl.getBoundingClientRect();
  const field = ed.querySelector<HTMLElement>(".field")!.getBoundingClientRect();
  // Startpunkt: linke Kante der Karte (Liste rechts vom Feld), sonst Oberkante (Liste unter dem Feld) oder Trikotmitte
  const sx = fromSlot ? sr.left + sr.width / 2 : sr.left > field.right - 10 ? sr.left : sr.left + sr.width / 2;
  const sy = fromSlot ? sr.top + sr.height / 2 : sr.left > field.right - 10 ? sr.top + sr.height / 2 : sr.top;
  // Liste unter dem Feld (Handy): keine langen Linien quer über die Seite, nur Ziele markieren
  const onlyTargets = !fromSlot && sr.left <= field.right - 10;
  const x0 = sx - box.left,
    y0 = sy - box.top;
  const parts: string[] = [];
  for (const c of cands) {
    const slot = ed.querySelector<HTMLElement>(`#pitchOut .slot[data-role="${c.role}"]`);
    const tok = slot?.querySelector<HTMLElement>(".token");
    if (!slot || !tok) continue;
    slot.classList.add("flow-target");
    const tr = tok.getBoundingClientRect();
    const x1 = tr.left + tr.width / 2 - box.left,
      y1 = tr.top + tr.height / 2 - box.top;
    const k = Math.max(0, Math.min(1, (c.rel - cut) / Math.max(1e-6, best - cut)));
    const w = 1.2 + 4.3 * k;
    const op = 0.55 + 0.45 * k;
    const q = flowClass(c.rel / best);
    const horizontal = Math.abs(x1 - x0) > Math.abs(y1 - y0);
    const d = horizontal
      ? `M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`
      : `M${x0},${y0} C${x0},${(y0 + y1) / 2} ${x1},${(y0 + y1) / 2} ${x1},${y1}`;
    const val = playerPositionRating(p, c.role).toFixed(1);
    // Beschriftung kurz vor dem Ziel auf der Kurve
    const t = 0.72,
      u = 1 - t;
    const [c1x, c1y, c2x, c2y] = horizontal ? [(x0 + x1) / 2, y0, (x0 + x1) / 2, y1] : [x0, (y0 + y1) / 2, x1, (y0 + y1) / 2];
    const lx = u ** 3 * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * x1;
    const ly = u ** 3 * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y1;
    parts.push(
      onlyTargets
        ? `<g class="${q}" opacity="${op.toFixed(2)}"><circle cx="${x1}" cy="${y1}" r="${(4 + 3 * k).toFixed(1)}"/><text x="${x1}" y="${y1 - tr.height / 2 - 4}" text-anchor="middle">${val}</text></g>`
        : `<g class="${q}" opacity="${op.toFixed(2)}"><path d="${d}" stroke-width="${w.toFixed(1)}"/><circle cx="${x1}" cy="${y1}" r="${(3 + 2 * k).toFixed(1)}"/><text x="${lx}" y="${ly - 6}" text-anchor="middle">${val}</text></g>`,
    );
  }
  ed.insertAdjacentHTML("beforeend", `<svg class="flow" aria-hidden="true">${parts.join("")}</svg>`);
}

function poolHtml(): string {
  const onField = new Set(state.manual.map((p) => p.playerId));
  const groups = squadGroups(state.hrf!.players);
  const pick = state.pick;
  const chip = (m: ReturnType<typeof squadGroups>[number]["members"][number], g: string) => {
    const p = m.player;
    const off = unavailable(p);
    const st = m.availability.status !== "fit" ? ` · <span class="status ${off ? "critical" : "warning"}"><i>${off ? "+" : "!"}</i>${esc(m.availability.label)}</span>` : "";
    return `<div class="pchip${off ? " off" : ""}${pick?.kind === "pool" && pick.id === p.id ? " picked" : ""}" ${off ? "" : `draggable="true"`} data-pid="${p.id}">
      <span class="n">${esc(p.name)}</span><span class="muted">${p.age} J.</span>
      <span class="m">${g} ${m.value.toFixed(1)} · Form ${p.form} · Kond. ${p.stamina}${st}</span></div>`;
  };
  const out: string[] = [];
  const shown = new Set<number>();
  for (const g of groups) {
    const ms = g.members.filter((m) => m.home && !onField.has(m.player.id) && !unavailable(m.player));
    if (!ms.length) continue;
    out.push(`<h4>${esc(g.name)}</h4>${ms.map((m) => chip(m, GROUP_SHORT[g.group])).join("")}`);
    ms.forEach((m) => shown.add(m.player.id));
  }
  const off = groups.flatMap((g) => g.members.filter((m) => m.home && unavailable(m.player)).map((m) => chip(m, GROUP_SHORT[g.group])));
  if (off.length) out.push(`<h4>Nicht einsetzbar</h4>${off.join("")}`);
  return `<div class="sub" style="margin-bottom:6px">Nicht aufgestellt (${state.hrf!.players.length - onField.size}). Hierher ziehen = vom Feld nehmen.</div>${out.join("") || "<p class='sub'>Alle Spieler sind aufgestellt.</p>"}`;
}

function renderExplain() {
  const L = state.league!;
  const mine = manualEval();
  const E = explain({ positions: L.lineup.positions, ratings: L.ratings, hatStats: L.hatStats }, { positions: state.manual, ...mine }, state.hrf!.players, state.hrf!.team.formationExperience);
  const d = E.hatStatsMine - E.hatStatsAuto;
  const arrow = (v: number) => (Math.abs(v) < 0.05 ? `<span class="muted">±0</span>` : `<span class="delta ${v > 0 ? "up" : "down"}">${v > 0 ? "▲ +" : "▼ "}${v.toFixed(2)}</span>`);
  const head = E.same
    ? `<div class="focus ok"><b>Entspricht dem automatischen Vorschlag.</b> Ziehe Spieler um, dann siehst du hier, was sich ändert.</div>`
    : `<div class="focus ${d >= 0 ? "ok" : ""}"><b>Deine Aufstellung: ${E.hatStatsMine.toFixed(0)} HatStats</b>, automatisch ${E.hatStatsAuto.toFixed(0)} (${d >= 0 ? "+" : ""}${d.toFixed(0)}). ${
        E.formationMine !== E.formationAuto ? `Formation ${formationLabel(E.formationMine)} statt ${formationLabel(E.formationAuto)}.` : ""
      }</div>`;
  const big = [...E.sectors].filter((x) => Math.abs(x.delta) >= 0.1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const S = settingsEffect(state.manual, playersById(), state.settings, teamState());
  const sBig = S.sectors.filter((x) => Math.abs(x.delta) >= 0.05);
  const dh = S.hatStatsNow - S.hatStatsBase;
  const settingsBlock = `<h3 style="margin-top:0">Wirkung von Taktik und Einstellung</h3>
    ${
      S.changed.length
        ? `<div class="focus ${dh >= 0 && S.loddarNow >= S.loddarBase ? "ok" : ""}"><b>${esc(S.changed.join(", "))}</b> gegenüber Normal: HatStats ${S.hatStatsNow.toFixed(0)} statt ${S.hatStatsBase.toFixed(0)} (${dh >= 0 ? "+" : ""}${dh.toFixed(0)}), LoddarStats ${S.loddarNow.toFixed(1)} statt ${S.loddarBase.toFixed(1)}.</div>
           ${sBig.length ? `<p>${sBig.map((x) => `<b>${esc(x.name)}</b> ${x.delta > 0 ? "+" : ""}${x.delta.toFixed(2)}`).join(", ")}.</p>` : `<p>Die Bewertungen der Mannschaftsteile ändern sich dadurch nicht.</p>`}`
        : `<p>Taktik, Einstellung und Ausrichtung stehen auf Normal. Wähle oben eine andere Taktik, dann siehst du hier, was sie bringt oder kostet.</p>`
    }
    <ul>${S.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    <p class="sub">LoddarStats (aus HO) gewichten wie HatStats die Mannschaftsteile, berücksichtigen aber auch, wohin die Angriffe laufen und die Konterstärke. Höher ist besser.</p>`;
  $("#explainOut").innerHTML = `<div class="explain">
    ${settingsBlock}
    <h3>Was sich gegenüber dem Vorschlag ändert</h3>
    ${head}
    ${big.length ? `<p>${big.map((x) => `<b>${esc(x.name)}</b> ${x.delta > 0 ? "steigt" : "sinkt"} von ${esc(ratingLabel(x.auto))} auf ${esc(ratingLabel(x.mine))}`).join("; ")}.</p>` : ""}
    <table class="cmp"><thead><tr><th>Mannschaftsteil</th><th class="num">Automatisch</th><th class="num">Deine</th><th class="num">Änderung</th></tr></thead><tbody>
      ${E.sectors.map((x) => `<tr title="${esc(ratingLabel(x.mine))}"><td>${esc(x.name)}</td><td class="num">${x.auto.toFixed(2)}</td><td class="num">${x.mine.toFixed(2)}</td><td class="num">${arrow(x.delta)}</td></tr>`).join("")}
      <tr><td><b>HatStats</b></td><td class="num">${E.hatStatsAuto.toFixed(0)}</td><td class="num"><b>${E.hatStatsMine.toFixed(0)}</b></td><td class="num">${arrow(d)}</td></tr>
    </tbody></table>
    ${E.changes.length ? `<h3>Deine Änderungen</h3><ul>${E.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${E.warnings.length ? `<h3>Achtung</h3><ul>${E.warnings.map((w) => `<li>${statusChip("warning", "", "!")} ${esc(w)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function renderLineup() {
  const L = state.league;
  if (!L) return;
  const byId = playersById();
  const m = state.match;
  $("#lineupSub").textContent = m ? `für ${fmtDate(m.date)} gegen ${m.homeId === state.hrf!.team.teamId ? m.awayName : m.homeName}` : "";
  const prev = tokenRects();
  renderFormationPick();
  $("#pitchOut").innerHTML = editPitch();
  animateTokens(prev);
  drawFlow();
  setTimeout(drawFlow, 450);
  $("#poolOut").innerHTML = poolHtml();
  renderExplain();
  const C = completeLineup(state.manual, state.hrf!.players, state.settings, $<HTMLInputElement>("#bruised").checked);
  const mine = manualEval();
  const bench = Object.entries(C.bench)
    .map(([slot, id]) => `<tr><td class="muted">${BENCH_DE[slot]}</td><td>${esc(byId.get(id!)?.name ?? "-")}</td></tr>`)
    .join("");
  $("#lineupSide").innerHTML = `
    <h3 style="margin-top:0">Deine Aufstellung</h3>
    <table><tbody>
      <tr><td class="muted">Formation</td><td><b>${formationLabel(formationCode(state.manual))}</b> <span class="muted">Erfahrung ${state.hrf!.team.formationExperience[formationCode(state.manual)] ?? 0}</span></td></tr>
      <tr><td class="muted">HatStats</td><td><b>${mine.hatStats.toFixed(0)}</b> <span class="muted">Ø über 90 Minuten</span></td></tr>
      <tr><td class="muted">LoddarStats</td><td><b>${loddarStats(mine.ratings, state.settings.tactic, tacticLevel(state.manual.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role })), state.settings.tactic)).toFixed(1)}</b></td></tr>
      <tr><td class="muted">Kapitän</td><td>${esc(byId.get(C.captainId)?.name ?? "-")}</td></tr>
      <tr><td class="muted">Standards</td><td>${esc(byId.get(C.setPiecesId)?.name ?? "-")}</td></tr>
    </tbody></table>
    <h3>Ersatzbank</h3>
    <table><tbody>${bench}</tbody></table>
    <details><summary>Formationen im Vergleich (automatisch)</summary>
      <table><thead><tr><th>Formation</th><th class="num">Erfahrung</th><th class="num">HatStats</th></tr></thead><tbody>
      ${L.perFormation.map((f) => `<tr><td>${formationLabel(f.formation)}</td><td class="num">${f.experience}</td><td class="num">${f.hatStats.toFixed(0)}</td></tr>`).join("")}
      </tbody></table>
    </details>`;
}

/** Spieler auf eine Position setzen: tauscht, wenn dort schon jemand steht */
function placePlayer(pid: number, role: number) {
  const p = playersById().get(pid);
  if (!p) return;
  if (unavailable(p)) return toast(`${p.name} ist ${p.injury > 0 ? "verletzt" : "gesperrt"}.`);
  const M = state.manual;
  const from = M.find((x) => x.playerId === pid);
  const occupant = M.find((x) => x.role === role);
  const fit = (r: number, b: number) => (behavioursFor(r).includes(b as never) ? b : Behaviour.normal);
  if (from) {
    if (from.role === role) return;
    if (occupant) {
      occupant.role = from.role as never;
      occupant.behaviour = fit(from.role, occupant.behaviour) as never;
    }
    from.role = role as never;
    from.behaviour = fit(role, from.behaviour) as never;
  } else if (occupant) {
    occupant.playerId = pid;
    occupant.behaviour = Behaviour.normal;
  } else {
    if (M.length >= 11) return toast("Schon 11 Spieler auf dem Feld. Erst einen herausnehmen.");
    M.push({ role: role as never, playerId: pid, behaviour: Behaviour.normal });
  }
  editorChanged();
}

function removeRole(role: number) {
  state.manual = state.manual.filter((x) => x.role !== role);
  editorChanged();
}

function editorChanged() {
  state.manualEdited = true;
  state.pick = null;
  renderLineup();
  renderWeakness();
}

function initWeakness() {
  $("#weakBasis").addEventListener("change", () => {
    state.weakBasis = $<HTMLSelectElement>("#weakBasis").value;
    renderWeakness();
  });
  $("#weakOut").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-weakbasis]");
    if (!b) return;
    state.weakBasis = b.dataset.weakbasis!;
    renderWeakness();
    $("#schwachstellen").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function initEditor() {
  const root = $("#aufstellung");
  const target = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".pitch.edit .slot, .pool");
  root.addEventListener("dragstart", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[draggable=true]");
    if (!el || !e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", el.classList.contains("slot") ? `r:${el.dataset.role}` : `p:${el.dataset.pid}`);
    requestAnimationFrame(() => el.classList.add("dragging"));
    state.flowPid = Number(el.dataset.pid) || null;
    drawFlow();
  });
  root.addEventListener("dragover", (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    root.querySelectorAll(".over").forEach((x) => x !== t && x.classList.remove("over"));
    t.classList.add("over");
  });
  root.addEventListener("dragleave", (e) => target(e)?.classList.remove("over"));
  root.addEventListener("dragend", () => {
    root.querySelectorAll(".dragging, .over").forEach((x) => x.classList.remove("dragging", "over"));
    state.flowPid = null;
    drawFlow();
  });
  $("#poolOut").addEventListener("scroll", () => drawFlow(), { passive: true });
  window.addEventListener("resize", () => drawFlow());
  root.addEventListener("drop", (e) => {
    // dragend kommt nicht mehr an, wenn das gezogene Element beim Neuzeichnen ersetzt wird
    state.flowPid = null;
    root.querySelectorAll(".dragging, .over").forEach((x) => x.classList.remove("dragging", "over"));
    const t = target(e);
    if (!t) {
      drawFlow();
      return;
    }
    e.preventDefault();
    t.classList.remove("over");
    const [kind, v] = (e.dataTransfer?.getData("text/plain") ?? "").split(":");
    const n = Number(v);
    if (!n) return;
    if (t.classList.contains("pool")) {
      if (kind === "r") removeRole(n);
      return;
    }
    const role = Number(t.dataset.role);
    if (kind === "p") placePlayer(n, role);
    else {
      const pos = state.manual.find((x) => x.role === n);
      if (pos) placePlayer(pos.playerId, role);
    }
  });
  // Tippen statt Ziehen (Handy): erst Spieler, dann Ziel
  root.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const rm = el.closest<HTMLElement>("[data-remove]");
    if (rm) return removeRole(Number(rm.dataset.remove));
    if (el.closest("select")) return;
    const chip = el.closest<HTMLElement>(".pchip");
    const slot = el.closest<HTMLElement>(".pitch.edit .slot");
    const pick = state.pick;
    state.flowPid = null;
    if (chip) {
      const id = Number(chip.dataset.pid);
      if (chip.classList.contains("off")) return;
      if (pick?.kind === "slot") {
        const pos = state.manual.find((x) => x.role === pick.role);
        if (pos) return placePlayer(id, pick.role);
      }
      state.pick = pick?.kind === "pool" && pick.id === id ? null : { kind: "pool", id };
      return renderLineup();
    }
    if (slot) {
      const role = Number(slot.dataset.role);
      if (pick?.kind === "pool") return placePlayer(pick.id, role);
      if (pick?.kind === "slot") {
        if (pick.role === role) {
          state.pick = null;
          return renderLineup();
        }
        const pos = state.manual.find((x) => x.role === pick.role);
        if (pos) return placePlayer(pos.playerId, role);
      }
      if (slot.dataset.pid) {
        state.pick = { kind: "slot", role };
        return renderLineup();
      }
      return;
    }
    if (el.closest(".pool") && pick?.kind === "slot") return removeRole(pick.role);
    // Klick daneben: Auswahl und Linien zurücksetzen
    clearFlow();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (state.pick || state.flowPid)) clearFlow();
  });
  // Klick außerhalb des Editors setzt ebenfalls zurück
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (!t.isConnected) return; // Element wurde beim Neuzeichnen ersetzt
    if ((state.pick || state.flowPid) && !(e.target as HTMLElement).closest("#aufstellung .editor, #aufstellung .editor-bar")) clearFlow();
  });
  root.addEventListener("change", (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-behaviour]");
    if (!sel) return;
    const pos = state.manual.find((x) => x.role === Number(sel.dataset.behaviour));
    if (pos) pos.behaviour = Number(sel.value) as never;
    editorChanged();
  });
  $("#autoFill").addEventListener("click", () => {
    if (!state.league) return;
    state.manual = formationPositions();
    state.manualEdited = !!state.formation;
    state.pick = null;
    renderLineup();
    toast(state.formation ? `Beste Elf für ${formationLabel(state.formation)} aufgestellt.` : "Feld automatisch aufgestellt.");
  });
  $("#formationPick").addEventListener("change", () => {
    state.formation = $<HTMLSelectElement>("#formationPick").value;
    state.manual = formationPositions();
    state.manualEdited = !!state.formation;
    state.pick = null;
    renderLineup();
  });
  $("#clearField").addEventListener("click", () => {
    state.manual = [];
    editorChanged();
  });
}

const STATUS_LABEL = { critical: ["!", "Schwach"], warning: ["–", "Ausbaufähig"], good: ["✓", "Solide"], serious: ["↓", ""] } as const;
const statusChip = (cls: "good" | "warning" | "serious" | "critical", label: string, icon: string) => `<span class="status ${cls}"><i>${icon}</i>${esc(label)}</span>`;

/** Grundlage der Schwachstellen: eigene Elf, automatischer Vorschlag oder beste Elf einer Formation */
function weakBasis(): { label: string; positions: FieldPosition[]; ratings: SectorRatings; formation: string } | null {
  const L = state.league;
  if (!L) return null;
  const b = state.weakBasis;
  if (b === "mine" && state.manual.length === 11) {
    return { label: "deiner Aufstellung", positions: state.manual, ratings: manualEval().ratings, formation: formationCode(state.manual) };
  }
  const f = state.formations.find((x) => x.code === b);
  if (f) return { label: `der besten Elf im ${formationLabel(f.code)}`, positions: f.positions, ratings: f.ratings, formation: f.code };
  return { label: "dem automatischen Vorschlag", positions: L.lineup.positions, ratings: L.ratings, formation: L.lineup.formation };
}

function renderWeakBasisPick() {
  const sel = document.querySelector<HTMLSelectElement>("#weakBasis");
  if (!sel) return;
  const exp = state.hrf?.team.formationExperience ?? {};
  const mine = state.manual.length === 11 ? ` (${formationLabel(formationCode(state.manual))})` : " (unvollständig, nutzt Vorschlag)";
  sel.innerHTML =
    `<option value="mine">Meine Aufstellung${mine}</option><option value="auto">Automatischer Vorschlag${state.league ? ` (${formationLabel(state.league.lineup.formation)})` : ""}</option>` +
    FORMATIONS.filter((f) => state.formations.some((x) => x.code === f))
      .map((f) => `<option value="${f}">Formation ${formationLabel(f)} · Erfahrung ${exp[f] ?? 0}</option>`)
      .join("");
  sel.value = state.weakBasis;
  if (sel.value !== state.weakBasis) sel.value = "mine";
}

/** Vergleich aller Formationen: Bewertung je Mannschaftsteil der jeweils besten Elf */
function formationCompareHtml(current: string): string {
  if (!state.formations.length) return `<p class="sub">Formationen werden berechnet …</p>`;
  const exp = state.hrf?.team.formationExperience ?? {};
  const rows = [...state.formations].sort((a, b) => b.hatStats - a.hatStats);
  const colMax = Object.fromEntries(RATING_SECTORS.map((k) => [k, Math.max(...rows.map((r) => r.ratings[k]))])) as Record<RatingSector, number>;
  const colMin = Object.fromEntries(RATING_SECTORS.map((k) => [k, Math.min(...rows.map((r) => r.ratings[k]))])) as Record<RatingSector, number>;
  const cell = (r: (typeof rows)[number], k: RatingSector) => {
    const span = colMax[k] - colMin[k];
    const q = span < 0.05 ? 0.5 : (r.ratings[k] - colMin[k]) / span;
    const avg = RATING_SECTORS.reduce((s, x) => s + r.ratings[x], 0) / RATING_SECTORS.length;
    const weak = r.ratings[k] - avg <= (k === "midfield" ? -1 / 1.3 : -1);
    return `<td class="num heat${weak ? " weakcell" : ""}" style="--q:${q.toFixed(2)}" title="${esc(ratingLabel(r.ratings[k]))}">${r.ratings[k].toFixed(2)}</td>`;
  };
  const SHORT: Record<RatingSector, string> = {
    defenceRight: "Abw. r", defenceCentral: "Abw. z", defenceLeft: "Abw. l", midfield: "Mittelf.", attackRight: "Angr. r", attackCentral: "Angr. z", attackLeft: "Angr. l",
  };
  return `<div class="scroll"><table class="nowrap fcmp"><thead><tr><th>Formation</th><th class="num">Erfahrung</th><th class="num">HatStats</th>${RATING_SECTORS.map((k) => `<th class="num">${SHORT[k]}</th>`).join("")}</tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr class="${r.code === current ? "cur" : ""}"><td><button class="linklike" data-weakbasis="${r.code}">${formationLabel(r.code)}</button></td>
        <td class="num">${exp[r.code] ?? 0}${(exp[r.code] ?? 0) < 6 ? ' <span class="warnmark" title="Unter 6 droht Desorganisation">⚠</span>' : ""}</td>
        <td class="num"><b>${r.hatStats.toFixed(0)}</b></td>${RATING_SECTORS.map((k) => cell(r, k)).join("")}</tr>`,
      )
      .join("")}
  </tbody></table></div>
  <p class="sub">Je Formation die beste Elf aus deinem Kader mit den Einstellungen der Aufstellungsseite. Grün = bester Wert dieser Spalte, rot umrandet = Schwachstelle in dieser Formation. ⚠ = Erfahrung unter 6, die Formation muss erst trainiert werden (Freundschaftsspiele in dieser Formation). Klick auf eine Formation zeigt oben ihre Schwachstellen.</p>`;
}

function renderWeakness() {
  const B = weakBasis();
  if (!B || !state.hrf) return;
  renderWeakBasisPick();
  const W = assessSectors(state.hrf.players, { positions: B.positions } as Lineup, B.ratings, state.settings, teamState());
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
  const exp = state.hrf.team.formationExperience[B.formation] ?? 0;
  const basisNote = `<p class="sub">Grundlage: ${esc(B.label)}, Formation ${formationLabel(B.formation)} (Erfahrung ${exp}), ${hatStatsOf(B.ratings).toFixed(0)} HatStats.${state.weakBasis === "mine" && state.manual.length < 11 ? " Deine Aufstellung hat noch keine 11 Spieler, deshalb wird der Vorschlag gezeigt." : ""}</p>`;
  $("#weakOut").innerHTML = `${basisNote}${focus}<div class="bars">${rows}</div>
    <p class="sub" style="margin-top:12px">Senkrechter Strich = Durchschnitt (${avg.toFixed(2)}). Das Mittelfeld zählt in den HatStats dreifach und entscheidet über den Ballbesitz, deshalb wird es strenger bewertet.</p>
    <h3>Welche Formation gleicht die Schwachstellen aus?</h3>${formationCompareHtml(B.formation)}`;
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

function renderPlan() {
  const P = state.plans;
  if (!P.length) return;
  const label: Record<string, [string, string]> = { critical: ["!", "Lücke"], warning: ["–", "dünn"], good: ["✓", "gut besetzt"] };
  const cell = (h: GroupPlan["horizons"][number], base: number, i: number) => {
    const diff = base ? h.average / base - 1 : 0;
    const trend = i === 0 || Math.abs(diff) < 0.03 ? "" : `<span class="${diff < 0 ? "down" : "up"}"> ${diff > 0 ? "+" : ""}${Math.round(diff * 100)} %</span>`;
    return `<td class="st"><span class="val">${h.average.toFixed(1)}</span>${trend}<br>${h.starters.map((e) => `${esc(e.name.split(" ").slice(-1)[0])} <span class="muted">${e.age}</span>`).join(", ")}${h.backup ? `<br><span class="muted">Ersatz: ${esc(h.backup.name.split(" ").slice(-1)[0])} (${h.backup.value.toFixed(1)})</span>` : ""}</td>`;
  };
  $("#planOut").innerHTML = `<div class="scroll"><table class="plan"><thead><tr><th>Mannschaftsteil</th><th>Jetzt</th><th>In 1 Saison</th><th>In 2 Saisons</th><th>Bewertung</th></tr></thead><tbody>
    ${P.map((g) => {
      const [icon, l] = label[g.severity];
      return `<tr><td><b>${esc(g.name)}</b><br><span class="muted">${g.needed} ${g.needed === 1 ? "Platz" : "Plätze"}</span></td>${g.horizons.map((h, i) => cell(h, g.horizons[0].average, i)).join("")}<td>${statusChip(g.severity, l, icon)}<br><span class="sub">${esc(g.note)}</span></td></tr>`;
    }).join("")}
    </tbody></table></div>
    <p class="sub">Zahl = durchschnittliche Positionsstärke der Stammspieler (HO-Formel), Alter zum jeweiligen Zeitpunkt. Plätze laut empfohlener Formation. Training und Altersabbau wie in der Spielerentwicklung; Form und Erfahrung bleiben gleich.</p>`;
}

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
  const hrf = state.hrf!;
  const B = budget(hrf.players, hrf.team.cash);
  const euro = (v: number) => `${Math.round(v).toLocaleString("de-DE")} €`;
  const profiles = state.profiles.length
    ? `<div class="profiles">${state.profiles
        .map(
          (p) => `<div class="profile"><h4>${esc(p.title)}</h4><div class="sub">${esc(p.reason)}</div><dl>
            <dt>Alter</dt><dd>${p.age[0]} bis ${p.age[1]} Jahre</dd>
            ${p.skills.map((k) => `<dt>${esc(k.name)}</dt><dd>${k.max ? `${k.min} bis ${k.max}` : `ab ${k.min}`}</dd>`).join("")}
            ${B.cash > 0 ? `<dt>Budget</dt><dd>bis ${euro(B.available)}</dd>` : ""}
          </dl></div>`,
        )
        .join("")}</div>
      <p class="sub">Werte so im Transfermarkt eintragen (Fertigkeit von/bis, Alter von/bis). Hauptfertigkeit zwei Stufen über dem schwächsten Stammspieler, weil gekaufte Spieler anfangs keine Treue haben. ${
        B.cash > 0 ? `Budget = Kontostand ${euro(B.cash)} minus fünf Wochen Gehälter (${euro(B.reserve)}).` : "Kontostand ist in der Datei nicht enthalten, deshalb ohne Budget."
      }</p>`
    : `<p class="focus ok">Kein dringender Transferbedarf: keine deutliche Schwachstelle und keine Lücke in der Kaderplanung.</p>`;
  $("#adviceOut").innerHTML = `
    <h3>Suchprofile für den Transfermarkt</h3>
    ${profiles}
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

// --- Navigation ------------------------------------------------------------------------

const VIEWS = ["spieltag", "aufstellung", "gegner", "kader", "schwachstellen", "entwicklung", "kaderplanung", "transfers", "training", "spielplan"];
const VIEW_ALIAS: Record<string, string> = { spiel: "spieltag", "": "spieltag" };
let currentView = "";

function route() {
  let v = decodeURIComponent(location.hash.slice(1));
  v = VIEW_ALIAS[v] ?? v;
  if (!VIEWS.includes(v)) v = "spieltag";
  document.querySelectorAll<HTMLElement>("main [data-view]").forEach((el) => el.classList.toggle("show", el.dataset.view === v));
  document.querySelectorAll<HTMLElement>(".sidenav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  if (v !== currentView) {
    window.scrollTo(0, 0);
    if (v === "aufstellung") requestAnimationFrame(kickoffAnimation);
    if (v === "schwachstellen") renderWeakness(); // eigene Aufstellung kann sich geändert haben
  }
  currentView = v;
  closeMenu();
}

function closeMenu() {
  $("#sideNav").classList.remove("open");
  $("#scrim").hidden = true;
}

function initNav() {
  window.addEventListener("hashchange", route);
  $("#menuBtn").addEventListener("click", () => {
    const open = !$("#sideNav").classList.contains("open");
    $("#sideNav").classList.toggle("open", open);
    $("#scrim").hidden = !open;
  });
  $("#scrim").addEventListener("click", closeMenu);
  document.querySelectorAll<HTMLButtonElement>("[data-kview]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-kview]").forEach((x) => x.classList.toggle("on", x === b));
      $("#groupsOut").hidden = b.dataset.kview !== "groups";
      $("#squadOut").hidden = b.dataset.kview !== "table";
    }),
  );
}

// --- Übersicht ------------------------------------------------------------------------

function renderTiles() {
  const hrf = state.hrf!;
  const L = state.league;
  const tiles: string[] = [];
  const tile = (href: string, k: string, v: string, sub: string) => `<a class="tile" href="#${href}"><div class="k">${k}</div><div class="v">${v}</div><div class="sub">${sub}</div></a>`;
  if (L) {
    const mine = manualEval();
    tiles.push(tile("aufstellung", "Aufstellung", `${formationLabel(formationCode(state.manual))} · ${mine.hatStats.toFixed(0)} HatStats`, state.manualEdited ? "deine Aufstellung (geändert)" : "automatischer Vorschlag"));
    const O = state.opponent;
    tiles.push(
      O
        ? tile("gegner", "Gegner-Check", esc(verdict(duels(L.ratings, O.average), attackCentral()).text), `aus ${O.matches.length} Spielen des Gegners`)
        : tile("gegner", "Gegner-Check", "keine Daten", "in HO den Gegnercheck machen"),
    );
  }
  const worst = [...state.weak].sort((a, b) => a.delta - b.delta)[0];
  if (worst) tiles.push(tile("schwachstellen", "Größte Schwachstelle", esc(worst.name), esc(ratingLabel(worst.rating))));
  const injured = hrf.players.filter((p) => p.injury > 0).length;
  const bruised = hrf.players.filter((p) => p.injury === 0).length;
  const banned = hrf.players.filter((p) => p.cards >= 3).length;
  tiles.push(tile("kader", "Kader", `${hrf.players.length - injured - banned} von ${hrf.players.length} einsatzbereit`, [injured ? `${injured} verletzt` : "", bruised ? `${bruised} angeschlagen` : "", banned ? `${banned} gesperrt` : ""].filter(Boolean).join(", ") || "alle fit"));
  const gaps = state.plans.filter((g) => g.severity !== "good");
  tiles.push(tile("kaderplanung", "Kaderplanung", gaps.length ? `${gaps.length} ${gaps.length === 1 ? "Baustelle" : "Baustellen"}` : "gut besetzt", gaps.map((g) => esc(g.name)).join(", ") || "auch in zwei Saisons"));
  if (state.profiles[0]) tiles.push(tile("transfers", "Transfer-Tipp", esc(state.profiles[0].title.split(":")[0]), esc(state.profiles[0].title.split(":")[1] ?? "")));
  $("#tiles").innerHTML = tiles.join("");
}

// --- Kader nach Mannschaftsteilen -------------------------------------------------------

const SKILL_SHORT: Record<string, string> = { keeper: "TW", defending: "VE", playmaking: "SA", winger: "FL", passing: "PS", scoring: "TS", setPieces: "ST" };

function renderGroups() {
  const inLineup = new Map(state.manual.map((p) => [p.playerId, lineupSector(p.role)]));
  const G = squadGroups(state.hrf!.players);
  const member = (m: (typeof G)[number]["members"][number], g: (typeof G)[number]) => {
    const p = m.player;
    const off = m.availability.factor === 0;
    const plays = inLineup.get(p.id) === g.group;
    const status =
      m.availability.status === "fit" ? "" : statusChip(off ? "critical" : "warning", m.availability.label, off ? "+" : "!");
    return `<div class="member${off ? " out" : ""}" title="Positionsstärke ${m.value.toFixed(2)} · Kondition hält ${Math.round(m.stamina * 100)} % · ${esc(m.availability.label)}">
      <div class="nm">${esc(p.name)} <small>${p.age} J.</small>${plays ? `<span class="inxi">spielt</span>` : ""}</div>
      <div class="fit" aria-label="Einsatzwert ${Math.round(m.share * 100)} %"><i style="width:${(m.share * 100).toFixed(0)}%"></i></div>
      <div class="attrs">${g.skills.map((k) => `<span>${SKILL_SHORT[k]} <b>${p[k]}</b></span>`).join("")}<span>Form <b>${p.form}</b></span><span>Kond. <b>${p.stamina}</b></span>${p.cards ? `<span>Gelb <b>${p.cards}</b></span>` : ""}${status}</div>
    </div>`;
  };
  $("#groupsOut").innerHTML = `<p class="sub">Je Mannschaftsteil die passenden Spieler, sortiert nach Einsatzwert. Balken = Positionsstärke (Fertigkeiten, Form, Erfahrung) × Kondition × Verfügbarkeit, relativ zum Besten der Gruppe. Verletzte und Gesperrte stehen durchgestrichen am Ende. Allrounder erscheinen in mehreren Gruppen.</p>
    <div class="groups">${G.map((g) => {
      const top = g.members.slice(0, 6);
      const more = g.members.slice(6);
      const ready = g.members.filter((m) => m.availability.factor > 0).length;
      return `<div class="group"><h3>${esc(g.name)}<span class="sub">${ready} einsatzbereit</span></h3>
        <div class="keys">Wichtig: ${g.skills.map((k) => DEV_SKILL_DE[k]).join(", ")}</div>
        ${top.map((m) => member(m, g)).join("")}
        ${more.length ? `<details><summary>${more.length} weitere</summary>${more.map((m) => member(m, g)).join("")}</details>` : ""}
      </div>`;
    }).join("")}</div>`;
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
  $("#dlLeague").addEventListener("click", () => {
    if (!state.hrf) return;
    const problems = lineupProblems(state.manual, playersById());
    if (problems.length) {
      $("#error").textContent = problems.join(" ");
      return;
    }
    download(completeLineup(state.manual, state.hrf.players, state.settings, $<HTMLInputElement>("#bruised").checked), "liga");
  });
  initEditor();
  initWeakness();
  initNav();
  $("#dlFriendly").addEventListener("click", () => state.friendly && download(state.friendly.lineup, "freundschaft"));
  // Countdown und Datenstand jede Minute auffrischen
  setInterval(() => state.hrf && (renderHero(), renderDataChip()), 60_000);
  initFolder();
}

init();
