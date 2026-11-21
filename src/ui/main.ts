// TopHatt-Oberfläche: eine einzige HTML-Seite, läuft offline im Browser. Keine Daten verlassen den Rechner.

import { DATA_FILE, type DirHandle, allExports, askPermission, chooseFolder, fileByName, folderApiAvailable, hasPermission, newestFile, storedFolder } from "./folder";
import { parseHrf, writeLineupToHrf } from "../core/hrf";
import { initHistory, importFile as importHistory, recordHrf, renderHistory, syncFolder as syncHistoryFolder } from "./history-view";
import { Attitude, Location, Role, Tactic, styleRange, type Hrf, type Lineup, type MatchSettings, type Player } from "../core/model";
import { HATSTATS_OBJECTIVE, formationLabel, hatStatsOf, optimizeLineup, type OptimizeResult } from "../core/optimizer";
import { type LineupSector, RATING_SECTORS, type RatingSector, type SectorRatings, lineupSector, playerPositionRating, ratingLabel } from "../core/rating";
import { FORMATION_PREFERENCE, TRAININGS, type TrainingWindow, type WeekMinutes, addPlanned, formationSlots, maxTrainingSlots, planFriendly, planTrainingLineup, playedThisWeek, positionShort, trainingFor, trainingPriority, trainingWindow, weekFactor, type FriendlyPlan } from "../core/training";
import { type CupPlan, type CupVariant, type LeagueChoice, type SquadTier, type WeekRow, TIER_NAME, chooseLeagueFormation, forgotten, planCup, slotText, suggestSquads, weekRows } from "../core/trainingweek";
import { advise, type Advice } from "../core/advisor";
import { type HoData, type HoMatch, MATCH_TYPE_DE, WEATHER_DE, parseHoData, roundOf, standings, upcomingMatches } from "../core/hodata";
import { DEV_SKILL_DE, type DevSkill, type PlayerOutlook, type ProjectionPoint, type TrainingSetup, mainSkills, outlookFor, project, skillsOf } from "../core/development";
import { type SectorAssessment, assessSectors } from "../core/weakness";
import { TACTIC_DE, type OpponentProfile, duels, opponentProfile, verdict } from "../core/opponent";
import { MODELLED_TACTICS, evaluateSettings, planMatch, styleName, type MatchPlan } from "../core/matchplan";
import { BACKUP_SHARE, type GroupPlan, GROUPS, GROUP_DE, GROUP_SHORT, GROUP_SKILLS, availability, balancedHome, fitTable, groupValue, planSquad, squadGroups, staminaShare } from "../core/squad";
import { type LineupChoices, completeLineup, evaluatePositions, explain, formationCode, lineupProblems, roleShort } from "../core/editor";
import { FORMATIONS, behavioursFor } from "../core/optimizer";
import { ATTITUDE_NAME, TACTIC_NAME, centralShare, loddarStats, settingsEffect, tacticLevel } from "../core/tactics";
import { Behaviour, type BenchSlot, type FieldPosition } from "../core/model";
import { type SearchProfile, budget, searchProfiles } from "../core/scouting";
import { type FinanceSnapshot, type PastWeek, parseFinance, pastWeeks } from "../core/finance";
import { renderFinance } from "./finance-view";
import { initTrainerPage, renderTrainerPage } from "./trainer";
import { type PlannedMove, initOrdersPage, loadOrders, ordersBlocking, ordersSummary, plannedMoves, renderOrdersPage, withOrders } from "./orders-view";
import { teamPlayers } from "../core/hodata";
import { avatarHtml, cutoutAvatars } from "./avatar";
import { LEVEL_DE } from "../core/staff";

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
/** Spielfeld wie in HO: Torwart oben, Blick zum gegnerischen Tor nach unten, rechte Seite links */
const GRID: Record<number, [number, number]> = {
  [Role.keeper]: [0, 2],
  [Role.rightBack]: [1, 0],
  [Role.rightCentralDefender]: [1, 1],
  [Role.middleCentralDefender]: [1, 2],
  [Role.leftCentralDefender]: [1, 3],
  [Role.leftBack]: [1, 4],
  [Role.rightWinger]: [2, 0],
  [Role.rightInnerMidfield]: [2, 1],
  [Role.centralInnerMidfield]: [2, 2],
  [Role.leftInnerMidfield]: [2, 3],
  [Role.leftWinger]: [2, 4],
  [Role.rightForward]: [3, 1],
  [Role.centralForward]: [3, 2],
  [Role.leftForward]: [3, 3],
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
  /** Finanzen der neuesten HRF und abgeschlossene Wochen aus allen HRF-Dateien */
  finance: FinanceSnapshot | null;
  financeWeeks: PastWeek[];
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
  pick: { kind: "pool"; id: number } | { kind: "slot"; role: number } | { kind: "bench"; slot: BenchSlot } | null;
  /** selbst gewählte Kapitän, Standards und Bankplätze (Rest automatisch) */
  choices: LineupChoices;
  /** gewählte Formation im Editor ("" = beste) und die beste Aufstellung je Formation */
  formation: string;
  formations: { code: string; hatStats: number; experience: number; positions: FieldPosition[]; ratings: SectorRatings }[];
  /** Grundlage der Schwachstellen: "mine" (Aufstellungsseite), "auto" oder ein Formationscode */
  weakBasis: string;
  /** Spieler, für den die Linien zu passenden Positionen gezeigt werden */
  flowPid: number | null;
  /** Spielerkarte: Vorschau beim Darüberfahren (Maus), Reiter rechts (Karte/Liste), beim Ziehen ausgeblendet */
  inspectPreview: number | null;
  inspectTab: "card" | "list";
  inspectSmall: boolean;
  dragging: boolean;
  /** Aufstellung: false = nur ansehen (Klick wechselt die Karte), true = ändern (Klick setzt/tauscht) */
  editMode: boolean;
  plans: GroupPlan[];
  /** Grundlage der Kaderplanung (wie Schwachstellen), z. B. „deiner Aufstellung“ */
  planBasis: string;
  /** Projektion der Fertigkeiten je Spieler (32 Wochen), einmal je Berechnung */
  projection: ((p: Player) => ProjectionPoint[]) | null;
  profiles: SearchProfile[];
  /** laufende Trainingswoche und was darin laut HRF schon gespielt wurde */
  week: { window: TrainingWindow; played: Map<number, WeekMinutes> } | null;
  /** Aufstellung: schon voll trainierte Spieler in der Liste ausblenden */
  hideTrained: boolean;
  /** Trainingself aktiv: Formationswechsel stellt weiter nur noch nicht trainierte Spieler auf */
  trainingMode: boolean;
  /** eigene Kaderzuordnung (A/B/Rest), überschreibt den Vorschlag */
  squadOwn: Record<number, SquadTier>;
  /** Pokalvarianten der Woche (im Hintergrund gerechnet) */
  cup: { key: string; plan: CupPlan; opponent: string; known: boolean } | null;
  cupPick: CupVariant["key"] | null;
}

const state: State = {
  hrf: null,
  finance: null,
  financeWeeks: [],
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
  choices: {},
  formation: "",
  formations: [],
  weakBasis: "mine",
  flowPid: null,
  inspectPreview: null,
  inspectTab: "card",
  inspectSmall: false,
  dragging: false,
  editMode: false,
  plans: [],
  planBasis: "",
  projection: null,
  profiles: [],
  week: null,
  hideTrained: false,
  trainingMode: false,
  squadOwn: {},
  cup: null,
  cupPick: null,
  settings: { location: Location.home, tactic: Tactic.normal, attitude: Attitude.normal, styleOfPlay: 0, teamSpiritSubIndex: 2 },
};

const bruisedOk = () => $<HTMLInputElement>("#bruised").checked;
/** Aufstellung aus dem Editor samt Kapitän, Standards und Bank (eigene Wahl, sonst automatisch) */
const myLineup = () => completeLineup(state.manual, state.hrf!.players, state.settings, bruisedOk(), state.choices);
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
  const text = await file.text();
  const hrf = parseHrf(text);
  state.finance = parseFinance(text);
  if (state.finance) state.financeWeeks = pastWeeks([state.finance]);
  if (!hrf.players.length) throw new Error(`In ${file.name} wurden keine Spieler gefunden. Ist es eine HRF-Datei aus HO?`);
  recordHrf(text);
  state.hrf = hrf;
  state.hrfName = file.name;
  state.hrfTime = file.lastModified;
}

/** Abgeschlossene Wochen aus allen HRF-Dateien (jede enthält die Vorwoche) */
async function setFinanceWeeks(files: File[]) {
  const snaps: FinanceSnapshot[] = [];
  for (const f of files) {
    try {
      const s = parseFinance(await f.text());
      if (s) snaps.push(s);
    } catch {
      /* kaputte Datei überspringen */
    }
  }
  if (state.finance) snaps.push(state.finance);
  state.financeWeeks = pastWeeks(snaps);
}

async function setHoData(file: File) {
  state.ho = parseHoData(await file.text());
  await cutoutAvatars(state.ho.avatars);
}

async function loadFiles(files: File[]) {
  $("#error").textContent = "";
  try {
    const hrfs = files.filter((f) => f.name.toLowerCase().endsWith(".hrf")).sort((a, b) => b.lastModified - a.lastModified);
    const isHistory = (f: File) => /verlauf/i.test(f.name);
    for (const f of files) if (f.name.toLowerCase().endsWith(".json") && isHistory(f)) await importHistory(f);
    const json = files.find((f) => f.name.toLowerCase().endsWith(".json") && !isHistory(f));
    if (hrfs[0]) await setHrf(hrfs[0]);
    if (hrfs.length > 1) await setFinanceWeeks(hrfs);
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
  await setFinanceWeeks(await allExports(h));
  const data = await fileByName(h, DATA_FILE);
  state.ho = data ? parseHoData(await data.text()) : null;
  if (state.ho) await cutoutAvatars(state.ho.avatars);
  $("#folderStatus").textContent = `Verbunden mit „${h.name}“. Geladen: ${hrf.name}${data ? ` und ${DATA_FILE}` : ""}.`;
  afterLoad(true);
  void syncHistoryFolder(h);
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
  applyStyleRange(hrf);
  if (resetMatch) {
    state.manualEdited = false;
    state.trainingMode = false;
    state.choices = {};
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

const ALL_STYLES: [number, string][] = [
  [-10, "Defensiv"],
  [-5, "Eher defensiv"],
  [0, "Ausgewogen"],
  [5, "Eher offensiv"],
  [10, "Offensiv"],
];

/** nur Ausrichtungen anbieten, die Trainer und Taktik-Assistenten erlauben (wie HO) */
function applyStyleRange(hrf: Hrf) {
  const [lo, hi] = styleRange(hrf.team);
  const sel = $<HTMLSelectElement>("#style");
  const old = Number(sel.value);
  const allowed = ALL_STYLES.filter(([v]) => v >= lo && v <= hi);
  if (!allowed.length) allowed.push([0, "Ausgewogen"]);
  sel.innerHTML = allowed.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  sel.value = String(allowed.some(([v]) => v === old) ? old : allowed.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a))[0]);
  sel.disabled = allowed.length === 1;
  const coach = hrf.team.trainerType === 2 ? "ausgeglichener Trainer" : hrf.team.trainerType === 0 ? "defensiver Trainer" : hrf.team.trainerType === 1 ? "offensiver Trainer" : "";
  sel.title = allowed.length === 1 ? `Nur ${allowed[0][1]} möglich: ${coach}, Taktik-Assistenten Stufe ${hrf.team.tacticalAssistants}` : "";
  const hint = document.querySelector<HTMLElement>("#styleHint");
  if (hint) hint.textContent = lo === -10 && hi === 10 ? "" : styleNoteFor(hrf.team);
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
    state.week = trainingWeekNow();
    refreshFriendly();
    state.setup = trainingSetup();
    state.outlooks = new Map(hrf.players.map((p) => [p.id, outlookFor(p, startSkills(p), state.setup!, trainingShare(p.id))]));
    const projections = new Map(hrf.players.map((p) => [p.id, project(startSkills(p), p.age, p.ageDays, state.setup!, trainingShare(p.id), 32)]));
    state.projection = (p) => projections.get(p.id)!;
    updateAnalysis();
    const m = state.match;
    state.opponent = m && state.ho ? opponentProfile(state.ho.matchRatings, m.homeId === hrf.team.teamId ? m.awayId : m.homeId) : null;
    loadOrders(m?.id || hrf.lineupMatchId);
    $("#error").textContent = "";
  } catch (e) {
    $("#error").textContent = (e as Error).message;
  }
  render();
}

/** Laufende Trainingswoche (Termine aus HO) und die schon gespielten Minuten laut HRF */
function trainingWeekNow(): State["week"] {
  const hrf = state.hrf!;
  const t = TRAININGS[hrf.team.trainingType];
  if (!t) return null;
  const dates = [...(state.ho?.training ?? []), ...(state.ho?.futureTraining ?? [])].map((x) => x.date);
  const window = trainingWindow(new Date(), dates);
  return { window, played: playedThisWeek(hrf.players, t, window) };
}

/**
 * Freundschaftsspiel neu planen: schon gespielte Minuten der Woche plus die eigene Liga-Aufstellung,
 * solange das Ligaspiel noch vor dem nächsten Trainingsupdate liegt.
 */
function refreshFriendly() {
  const hrf = state.hrf;
  if (!hrf || !state.league) return;
  const w = state.week;
  const m = state.match;
  const leagueInWeek = !w || !m || m.date.getTime() < w.window.end.getTime();
  const positions = state.manual.length ? state.manual : state.league.lineup.positions;
  try {
    state.friendly = planFriendly(hrf.players, { positions: leagueInWeek ? positions : [] }, hrf.team.trainingType, bruisedOk(), w?.played, hrf.team.formationExperience);
  } catch {
    state.friendly = null;
  }
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
  renderWeakness();
  renderDevelopment();
  renderPlan();
  renderSchedule();
  renderFriendly();
  renderAdvice();
  renderSquad();
  renderGroups();
  renderFinance($("#finOut"), state.finance, state.financeWeeks);
  renderTrainerPage($("#trainerOut"), hrf.raw);
  renderHistory();
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
  // Auf dem Handy steht der Datenstand im Menü statt in der Kopfzeile
  const nav = $("#navDataChip");
  nav.hidden = false;
  nav.className = chip.className + " navchip";
  nav.innerHTML = chip.innerHTML;
  nav.title = chip.title;
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
    tierCache = null;
    renderLineup();
    renderTrainingWeek();
    if (state.weakBasis !== "mine" && state.weakBasis !== "auto") {
      updateAnalysis();
      renderAdvice();
    }
    renderWeakness();
  }, 30);
}

/** Aufstellung für die gewählte Formation (oder die beste) */
/** Abzeichen am Spieler: diese Trainingswoche schon trainiert (✓) oder halb (½), sonst nichts */
function trainingBadge(id: number): string {
  const m = state.week?.played.get(id);
  const f = weekFactor(m);
  if (f <= 0) return "";
  const src = m!.sources.join(", ");
  return f >= 1
    ? `<span class="trb done" title="Diese Trainingswoche schon trainiert (${esc(src)})">✓</span>`
    : `<span class="trb half" title="Diese Trainingswoche schon halb trainiert (${esc(src)})">½</span>`;
}

/**
 * Trainingself für jede Formation: Trainingsplätze und HatStats der so aufgestellten Elf.
 * Sortiert: meiste Trainingsplätze zuerst, dann die stärkere Elf (HatStats), dann Erfahrung, dann die ausgewogenere Formation.
 */
function trainingChoices() {
  const hrf = state.hrf!;
  const t = TRAININGS[hrf.team.trainingType];
  const byId = playersById();
  return FORMATIONS.map((f) => {
    const plan = planTrainingLineup(hrf.players, hrf.team.trainingType, state.week!.played, bruisedOk(), hrf.team.formationExperience, f);
    const x = formationSlots(t, f);
    const hatStats = evaluatePositions(plan.lineup.positions, byId, state.settings, teamState()).hatStats;
    return { f, plan, full: x.full, partly: x.partly, hatStats, exp: hrf.team.formationExperience[f] ?? 0 };
  }).sort(
    (a, b) =>
      b.full * 10 + b.partly - (a.full * 10 + a.partly) ||
      Math.round(b.hatStats) - Math.round(a.hatStats) ||
      b.exp - a.exp ||
      FORMATION_PREFERENCE.indexOf(a.f) - FORMATION_PREFERENCE.indexOf(b.f),
  );
}

/** Trainingself für eine Formation ("" = meiste Trainingsplätze, bei Gleichstand stärkste Elf) */
function trainingPlan(formation: string) {
  const c = trainingChoices();
  return (c.find((x) => x.f === formation) ?? c[0]).plan;
}

/** Formationskarte (Aufstellung und Trainingself) */
function formationCard(o: { f: string; hatStats: number; exp: number; on: boolean; reco: boolean; min: number; max: number; attr: string; extra?: string }): string {
  const w = o.max > o.min ? 25 + (75 * (o.hatStats - o.min)) / (o.max - o.min) : 100;
  return `<button type="button" class="tf-card${o.on ? " on" : ""}${o.reco ? " reco" : ""}" ${o.attr} aria-pressed="${o.on}">
      ${o.reco ? `<span class="tf-reco">Empfehlung</span>` : ""}<span class="tf-f">${formationLabel(o.f)}</span>
      <span class="tf-hs"><b>${o.hatStats.toFixed(0)}</b> HatStats${o.extra ?? ""}<i style="width:${w.toFixed(0)}%"></i></span>
      <span class="tf-exp${o.exp < 6 ? " low" : ""}">${o.exp < 6 ? "⚠ " : ""}Erfahrung ${o.exp}</span>
    </button>`;
}

/** Formationswahl für die beste Elf: eingespielte Formationen (Erfahrung ab 6) offen, die übrigen eingeklappt */
function formationCardsHtml(): string {
  const F = [...state.formations].sort((a, b) => b.hatStats - a.hatStats);
  const best = state.league?.lineup.formation;
  if (!F.length || !best) return `<div class="trmode fpanel"><p class="sub" style="margin:0">Formationen werden berechnet …</p></div>`;
  const current = state.formation || best;
  const min = Math.min(...F.map((x) => x.hatStats));
  const max = Math.max(...F.map((x) => x.hatStats));
  const bestHs = state.league!.hatStats;
  const minExp = Number($<HTMLSelectElement>("#minExp").value);
  const card = (x: (typeof F)[number]) => {
    const d = x.hatStats - bestHs;
    return formationCard({
      f: x.code,
      hatStats: x.hatStats,
      exp: x.experience,
      on: x.code === current,
      reco: x.code === best,
      min,
      max,
      attr: `data-fc="${x.code === best ? "" : x.code}"`,
      extra: x.code === best || Math.abs(d) < 0.5 ? "" : ` <span class="tf-d">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}</span>`,
    });
  };
  const good = F.filter((x) => x.experience >= 6 || x.code === best);
  const weak = F.filter((x) => !good.includes(x));
  const stronger = weak.filter((x) => x.hatStats > bestHs + 0.5);
  const why = `Empfehlung ${formationLabel(best)}: die stärkste Elf nach HatStats${minExp ? ` unter den Formationen mit Erfahrung ab ${minExp}` : ""}.${stronger.length ? ` ${stronger.map((x) => formationLabel(x.code)).join(", ")} ${stronger.length === 1 ? "hätte" : "hätten"} mehr HatStats, aber zu wenig Erfahrung (Gefahr Desorganisation).` : ""}`;
  return `<div class="trmode fpanel">
    <div class="trmode-top"><b>Formation</b><span>${esc(why)} Antippen stellt die beste Elf für diese Formation auf.</span></div>
    <div class="tf-group"><div class="tf-head">Eingespielt (Erfahrung ab 6)</div><div class="tf-grid">${good.map(card).join("")}</div></div>
    ${weak.length ? `<details class="tf-more"${weak.some((x) => x.code === current) ? " open" : ""}><summary>Wenig Erfahrung (unter 6): ${weak.map((x) => formationLabel(x.code)).join(", ")}</summary><div class="tf-group"><div class="tf-grid">${weak.map(card).join("")}</div></div></details>` : ""}
  </div>`;
}

/** Formationswahl im Trainingself-Modus: Karten, gruppiert nach Trainingsplätzen, Empfehlung hervorgehoben */
function trainingPickHtml(): string {
  const t = TRAININGS[state.hrf!.team.trainingType];
  const c = trainingChoices();
  const top = c[0];
  const current = state.formation || top.f;
  const maxHs = Math.max(...c.map((x) => x.hatStats));
  const minHs = Math.min(...c.map((x) => x.hatStats));
  const groups = new Map<string, typeof c>();
  for (const x of c) {
    const k = `${x.full}|${x.partly}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const dots = (x: (typeof c)[number]) =>
    `<span class="tf-dots" aria-label="${x.full} volle, ${x.partly} halbe Trainingsplätze">${"<i class=full></i>".repeat(x.full)}${"<i class=half></i>".repeat(x.partly)}</span>`;
  const card = (x: (typeof c)[number]) =>
    formationCard({ f: x.f, hatStats: x.hatStats, exp: x.exp, on: x.f === current, reco: x === top, min: minHs, max: maxHs, attr: `data-tf="${x.f}"` });
  const head = (x: (typeof c)[number]) => `${dots(x)} ${x.full} voll${x.partly ? ` + ${x.partly} halb` : ""}`;
  const ties = groups.get(`${top.full}|${top.partly}`)!.length;
  const gs = [...groups.values()];
  const group = (g: typeof c) => `<div class="tf-group"><div class="tf-head">${head(g[0])}</div><div class="tf-grid">${g.map(card).join("")}</div></div>`;
  return `<div class="trmode">
    <div class="trmode-top"><b>Trainingself aktiv</b><span>Auf die Trainingsplätze (${esc(t.name)}) kommen nur Spieler, die diese Trainingswoche noch nicht trainiert haben, die Jüngsten zuerst.${state.week!.played.size ? "" : " Seit dem letzten Trainingsupdate wurde noch nicht gespielt, deshalb stehen alle zur Wahl."} Formation antippen, der Modus bleibt.</span><button class="btn" id="trainingOff">Zurück zur besten Elf</button></div>
    <p class="sub tf-why">Empfehlung ${formationLabel(top.f)}: ${ties > 1 ? `die stärkste Elf unter ${ties} Formationen mit gleich vielen Trainingsplätzen` : "die meisten Trainingsplätze"}. Unter Erfahrung 6 droht Desorganisation.</p>
    ${group(gs[0])}
    ${gs.length > 1 ? `<details class="tf-more"${gs.slice(1).some((g) => g.some((x) => x.f === current)) ? " open" : ""}><summary>Weitere Formationen mit weniger Trainingsplätzen</summary>${gs.slice(1).map(group).join("")}</details>` : ""}
  </div>`;
}

function applyTrainingFormation(f: string) {
  state.formation = f;
  const plan = trainingPlan(f);
  state.manual = plan.lineup.positions.map((p) => ({ ...p }));
  state.choices = {};
  editorChanged();
  toast(`Trainingself ${formationLabel(plan.lineup.formation)}: ${plan.gaining.length} Spieler bekommen dadurch Training.`);
}

function formationPositions(): FieldPosition[] {
  const f = state.formations.find((x) => x.code === state.formation);
  return (f ? f.positions : state.league!.lineup.positions).map((p) => ({ ...p }));
}

function renderFormationPick() {
  const sel = $<HTMLSelectElement>("#formationPick");
  const best = state.league?.lineup.formation;
  const t = state.hrf ? TRAININGS[state.hrf.team.trainingType] : undefined;
  $("#trainingFill").classList.toggle("primary", state.trainingMode);
  $("#autoFill").classList.toggle("primary", !state.trainingMode);
  sel.classList.toggle("training", state.trainingMode);
  // Formation wählt man über die Karten darunter; das Auswahlfeld bleibt nur als Rückfall
  const training = !!(state.trainingMode && t && state.week);
  sel.closest("label")!.hidden = training || state.formations.length > 0;
  $("#trainingModeBar").innerHTML = training ? trainingPickHtml() : formationCardsHtml();
  sel.innerHTML =
    `<option value="">Beste${best ? `: ${formationLabel(best)}` : ""} (automatisch)</option>` +
    [...state.formations]
      .sort((a, b) => b.hatStats - a.hatStats)
      .map((f) => `<option value="${f.code}"${f.code === state.formation ? " selected" : ""}>${formationLabel(f.code)} · ${f.hatStats.toFixed(0)} HatStats · Erfahrung ${f.experience}${f.experience < 6 ? " ⚠ zu wenig Erfahrung" : ""}</option>`)
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

const FIELD_LINES = `<svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(0 100) scale(1 -1)">
  <rect x="2" y="1.5" width="96" height="97" rx="0.5"/>
  <path d="M2 1.5 H98"/><path d="M38 1.5 A12 9 0 0 0 62 1.5"/><circle class="dot" cx="50" cy="1.5" r="0.7"/>
  <rect x="22" y="80" width="56" height="18.5"/><rect x="36" y="91.5" width="28" height="7"/>
  <path d="M40 80 A11 6 0 0 1 60 80"/><circle class="dot" cx="50" cy="87.5" r="0.6"/>
  <path d="M44 98.5 v1.2 h12 v-1.2"/>
</g></svg>`;

const de = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const hsDiff = (d: number) => (Math.abs(d) < 0.5 ? "" : ` <span class="${d > 0 ? "up" : "down"}">(${d > 0 ? "+" : ""}${d.toFixed(0)} zum Vorschlag)</span>`);
function warnText(p: Player): string {
  const w: string[] = [];
  if (p.injury === 0) w.push("angeschlagen");
  if (p.cards === 2) w.push("2 Gelbe Karten");
  if (p.stamina <= 5) w.push(`Kondition ${p.stamina}, baut in der 2. Halbzeit ab`);
  return `${p.name}: ${w.join(", ")}`;
}

/** Spielerbild auf Feld und Bank: Figur aus HO (freigestellt) auf der Fläche in Kaderfarbe */
function tokenFace(p: Player): string {
  return `<span class="tk-img" aria-hidden="true">${avatarHtml(p.id, state.ho?.avatars, shirtNo(p), false)}</span><span class="sr-only">${esc(initials(p.name))}</span>`;
}

/** Wechsel-Markierung unter einem Spieler: ▼ raus, ▲ rein, ⇄ Tausch, mit Minute und Gegenüber */
function movePills(id: number, moves: Map<number, PlannedMove[]>, byId: Map<number, Player>): string {
  const list = moves.get(id);
  if (!list) return "";
  const last = (pid: number) => (byId.get(pid)?.name ?? "?").split(" ").slice(-1)[0];
  return list
    .map((m) => {
      const icon = m.kind === "out" ? "▼" : m.kind === "in" ? "▲" : "⇄";
      const verb = m.kind === "out" ? `geht in Minute ${m.minute} raus, für ${byId.get(m.other)?.name ?? "?"}` : m.kind === "in" ? `kommt in Minute ${m.minute} für ${byId.get(m.other)?.name ?? "?"}` : `tauscht in Minute ${m.minute} mit ${byId.get(m.other)?.name ?? "?"}`;
      const title = `${byId.get(id)?.name ?? ""} ${verb}${m.cond ? ` (nur wenn ${m.cond})` : ""}`;
      return `<button type="button" class="subpill ${m.kind}" data-goto="secSubs" title="${esc(title)}"><b>${icon}</b>${m.minute}′${m.cond ? "*" : ""}<span class="sp-who"> ${esc(m.kind === "in" ? `für ${last(m.other)}` : last(m.other))}</span></button>`;
    })
    .join("");
}

function editPitch(): string {
  const byId = playersById();
  const moves = plannedMoves();
  const L = state.league!;
  const C = myLineup();
  const fit = fitTable(state.hrf!.players);
  const pick = state.pick;
  const slots = Object.entries(GRID).map(([r, [row, col]]) => {
    const role = Number(r);
    const pos = state.manual.find((x) => x.role === role);
    const style = `grid-row:${row + 1};grid-column:${col + 1}`;
    const picked = pick?.kind === "slot" && pick.role === role ? " picked" : "";
    if (!pos) return `<div class="slot empty${picked}" data-role="${role}" style="${style}"><div class="role">${ROLE_DE[role]}</div><div class="token av">+</div><div class="pname">frei</div></div>`;
    const p = byId.get(pos.playerId);
    const auto = L.lineup.positions.find((x) => x.role === role);
    const changed = !auto || auto.playerId !== pos.playerId || auto.behaviour !== pos.behaviour;
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
    return `<div class="slot${picked}" draggable="${state.editMode}" data-role="${role}" data-pid="${pos.playerId}" style="${style}" title="${esc(ratingTitle)}">
      <div class="role">${ROLE_DE[role]}</div>
      <div class="token av tk-${tierOf(pos.playerId) ?? "R"} ${fc}">${p ? tokenFace(p) : "?"}${p ? `<span class="stat">${de(playerPositionRating(p, role, pos.behaviour), 1)}</span>` : ""}${warn ? `<span class="warn" title="${esc(warnText(p!))}">!</span>` : ""}${trainingBadge(pos.playerId)}${pos.behaviour ? `<span class="bh" title="${BEHAVIOUR_DE[pos.behaviour]}">${BEHAVIOUR_SHORT[pos.behaviour]}</span>` : ""}</div>
      <div class="pname">${esc((p?.name ?? "?").split(" ").slice(-1)[0])}</div>
      <div class="meta">Form ${p?.form ?? "-"} · Kond. ${p?.stamina ?? "-"} ${tags}</div>
      ${movePills(pos.playerId, moves, byId)}
    </div>`;
  });
  const mine = manualEval();
  return `<div class="field">${FIELD_LINES}<div class="pitch edit">${slots.join("")}</div>
    <div class="stats-strip"><span>${formationLabel(formationCode(state.manual))}</span><span><b>${mine.hatStats.toFixed(0)}</b> HatStats${hsDiff(mine.hatStats - L.hatStats)}</span><span>${state.manual.length}/11</span></div></div>
    ${benchHtml(C)}
    <div class="flow-legend"><span><i style="color:#3ddc6a"></i>passende Position</span><span><i style="color:#ffd23f"></i>geht</span><span><i style="color:#ff5a4a"></i>schwach</span><span><i style="color:#b4bcc4"></i>Notlösung</span><span>gilt für Ring und Linien · Zahl = Positionsstärke · ! = Warnung · OFF/DEF/MIT/AUS = Verhalten</span><span class="tk-legend"><i class="tk-A"></i>A-Kader <i class="tk-B"></i>B-Kader <i class="tk-R"></i>Rest · Kreisfarbe = Kader (änderbar unter Trainingswoche)</span><span><b class="lg-out">▼</b> raus · <b class="lg-in">▲</b> rein · <b class="lg-swap">⇄</b> Tausch, mit Minute (* = nur unter Bedingung) · antippen öffnet die Anweisungen</span>${state.week ? `<span><b class="trb done">✓</b> diese Woche schon trainiert · <b class="trb half">½</b> halb · ohne Zeichen = noch nicht trainiert</span>` : ""}</div>
`;
}

const BEHAVIOUR_SHORT = ["", "OFF", "DEF", "MIT", "AUS"];
const BENCH_SHORT: Record<BenchSlot, string> = { keeper: "TW", centralDefender: "IV", wingBack: "AV", innerMidfield: "ZM", forward: "ST", winger: "FL", extra: "Joker" };
const BENCH_ORDER: BenchSlot[] = ["keeper", "centralDefender", "wingBack", "innerMidfield", "winger", "forward", "extra"];
const BENCH_ROLE: Record<BenchSlot, number> = {
  keeper: Role.keeper,
  centralDefender: Role.middleCentralDefender,
  wingBack: Role.rightBack,
  innerMidfield: Role.centralInnerMidfield,
  winger: Role.rightWinger,
  forward: Role.centralForward,
  extra: Role.centralForward,
};

/** Ersatzbank als zweite Reihe unter dem Feld */
function benchHtml(C: Lineup): string {
  const byId = playersById();
  const moves = plannedMoves();
  const pick = state.pick;
  const fixed = state.choices.bench ?? {};
  const cells = BENCH_ORDER.map((slot) => {
    const id = C.bench[slot];
    const p = id ? byId.get(id) : undefined;
    const own = slot in fixed;
    const picked = pick?.kind === "bench" && pick.slot === slot ? " picked" : "";
    if (!p)
      return `<div class="bslot empty${picked}" data-bench="${slot}"><div class="role">${BENCH_SHORT[slot]}</div><div class="token av">+</div><div class="pname">${own ? "leer" : "frei"}</div></div>`;
    const v = slot === "extra" ? Math.max(...[Role.leftCentralDefender, Role.leftBack, Role.leftInnerMidfield, Role.leftWinger, Role.centralForward].map((r) => playerPositionRating(p, r))) : playerPositionRating(p, BENCH_ROLE[slot]);
    return `<div class="bslot${picked}" draggable="${state.editMode}" data-bench="${slot}" data-pid="${p.id}" title="${esc(`${BENCH_DE[slot]}: ${p.name}, Stärke ${v.toFixed(2)}, Form ${p.form}, Kondition ${p.stamina}${own ? "" : " · automatisch gewählt"}`)}">
      <div class="role">${BENCH_SHORT[slot]}</div>
      <div class="token av tk-${tierOf(p.id) ?? "R"}">${tokenFace(p)}<span class="stat">${de(v, 1)}</span>${trainingBadge(p.id)}</div>
      <div class="pname">${esc(p.name.split(" ").slice(-1)[0])}</div>
      ${moves.has(p.id) ? movePills(p.id, moves, byId) : `<div class="meta">${own ? "von dir" : "auto"}</div>`}
    </div>`;
  });
  return `<div class="bench" aria-label="Ersatzbank"><div class="bench-head">Ersatzbank <span>ziehen oder antippen zum Ändern</span></div><div class="bench-row">${cells.join("")}</div></div>`;
}

/** Spieler auf einen Bankplatz setzen; steht er schon auf einem anderen, tauschen beide */
function setBench(slot: BenchSlot, pid: number) {
  const p = playersById().get(pid);
  if (!p) return;
  if (unavailable(p)) return toast(`${p.name} ist ${p.injury > 0 ? "verletzt" : "gesperrt"}.`);
  const C = myLineup();
  const bench = { ...(state.choices.bench ?? {}) };
  const from = (Object.keys(C.bench) as BenchSlot[]).find((k) => C.bench[k] === pid);
  if (from === slot) return editorChanged();
  if (from) bench[from] = C.bench[slot] ?? 0;
  const field = state.manual.find((x) => x.playerId === pid);
  if (field) {
    // vom Feld auf die Bank: der bisherige Bankspieler bleibt draußen
    state.manual = state.manual.filter((x) => x !== field);
  }
  bench[slot] = pid;
  state.choices = { ...state.choices, bench };
  editorChanged();
}

/** Bankspieler auf eine Feldposition; ein dort stehender Spieler geht auf seinen Bankplatz */
function benchToField(slot: BenchSlot, role: number) {
  const id = myLineup().bench[slot];
  if (!id) return;
  const occupant = state.manual.find((x) => x.role === role);
  const bench = { ...(state.choices.bench ?? {}) };
  if (occupant) bench[slot] = occupant.playerId;
  else delete bench[slot];
  state.choices = { ...state.choices, bench };
  placePlayer(id, role);
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
const FLOW_LINES = 3;
function flowClass(share: number): string {
  if (share >= 0.97) return "fq1"; // optimal (grün)
  if (share >= 0.88) return "fq2"; // gut (gelb)
  if (share >= 0.79) return "fq3"; // mäßig (rot)
  return "fq4"; // Notlösung (grau)
}

/** Linien ausblenden und Auswahl aufheben */
function clearFlow() {
  state.flowPid = null;
  state.inspectPreview = null;
  if (state.pick) {
    state.pick = null;
    renderLineup();
  } else {
    renderInspect();
    drawFlow();
  }
}

/** passende Positionen eines Spielers (wie die Linien): bis 70 % der besten Eignung, beste zuerst */
function flowCands(p: Player, exceptRole?: number) {
  const fit = fitTable(state.hrf!.players);
  const groups = [...new Set(Object.keys(GRID).map((r) => lineupSector(Number(r))))];
  const best = Math.max(...groups.map((g) => fit.rel(p, g)));
  const cut = best * FLOW_CUT;
  const cands = Object.keys(GRID)
    .map(Number)
    .filter((role) => role !== exceptRole)
    .map((role) => ({ role, rel: fit.rel(p, lineupSector(role)), val: playerPositionRating(p, role) }))
    .filter((c) => c.rel >= cut)
    .sort((a, b) => b.rel - a.rel || b.val - a.val)
    .slice(0, 9);
  return { cands, best, cut };
}

function drawFlow() {
  const ed = document.querySelector<HTMLElement>("#aufstellung .editor");
  if (!ed) return;
  ed.querySelector("svg.flow")?.remove();
  ed.classList.remove("flow-focus");
  ed.querySelectorAll(".flow-target,.flow-hint,.flow-src").forEach((x) => {
    x.classList.remove("flow-target", "flow-hint", "flow-src");
    delete (x as HTMLElement).dataset.fq;
  });
  const pick = state.pick;
  const pid =
    state.flowPid ??
    (pick?.kind === "pool" ? pick.id : pick?.kind === "slot" ? (state.manual.find((x) => x.role === pick.role)?.playerId ?? null) : pick?.kind === "bench" ? (myLineup().bench[pick.slot] ?? null) : null);
  if (!pid || !state.hrf || ed.offsetParent === null) return;
  const p = playersById().get(pid);
  if (!p) return;
  const fromSlot = state.manual.find((x) => x.playerId === pid);
  const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);
  // Liste von der Spielerkarte verdeckt: Linien starten am Bild in der Karte
  const srcEl = fromSlot
    ? ed.querySelector<HTMLElement>(`#pitchOut .slot[data-pid="${pid}"] .token`)
    : (ed.querySelector<HTMLElement>(`#pitchOut .bslot[data-pid="${pid}"] .token`) ??
      visible(ed.querySelector<HTMLElement>(`#poolOut .pchip[data-pid="${pid}"]`)) ??
      visible(ed.querySelector<HTMLElement>(`#inspectOut .ic-av`)));
  if (!srcEl) return;
  const { cands, best, cut } = flowCands(p, fromSlot?.role);
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
  let i = 0;
  for (const c of cands) {
    const slot = ed.querySelector<HTMLElement>(`#pitchOut .slot[data-role="${c.role}"]`);
    const tok = slot?.querySelector<HTMLElement>(".token");
    if (!slot || !tok) continue;
    const q = flowClass(c.rel / best);
    // Nur die drei besten passenden Plätze (grün/gelb) bekommen eine Linie, die übrigen nur einen dezenten Ring
    if (i >= FLOW_LINES || q === "fq3" || q === "fq4") {
      slot.classList.add("flow-hint");
      slot.dataset.fq = q;
      i++;
      continue;
    }
    i++;
    slot.classList.add("flow-target");
    const tr = tok.getBoundingClientRect();
    const x1 = tr.left + tr.width / 2 - box.left,
      y1 = tr.top + tr.height / 2 - box.top;
    const k = Math.max(0, Math.min(1, (c.rel - cut) / Math.max(1e-6, best - cut)));
    const w = 1.2 + 4.3 * k;
    const op = 0.55 + 0.45 * k;
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
  // Hervorheben: in Frage kommende Positionen und der Spieler selbst bleiben, alles andere tritt zurück
  srcEl.closest(".slot, .bslot")?.classList.add("flow-src");
  ed.classList.add("flow-focus");
}

function poolHtml(): string {
  const onField = new Set(state.manual.map((p) => p.playerId));
  const benchIds = new Set(Object.values(myLineup().bench));
  const groups = squadGroups(state.hrf!.players);
  const pick = state.pick;
  const played = state.week?.played;
  const trained = (id: number) => weekFactor(played?.get(id));
  const chip = (m: ReturnType<typeof squadGroups>[number]["members"][number], g: string, sector: LineupSector) => {
    const p = m.player;
    const off = unavailable(p);
    const tf = trained(p.id);
    const src = played?.get(p.id)?.sources.join(", ") ?? "";
    const tr = tf >= 1 ? ` · <span class="status good" title="Diese Trainingswoche schon ${esc(src)}"><i>✓</i>trainiert</span>` : tf > 0 ? ` · <span class="status warning" title="Diese Trainingswoche schon ${esc(src)}"><i>½</i>halb trainiert</span>` : "";
    const st = (m.availability.status !== "fit" ? ` · <span class="status ${off ? "critical" : "warning"}"><i>${off ? "+" : "!"}</i>${esc(m.availability.label)}</span>` : "") + tr;
    // wie die Spielerliste auf Hattrick: Bild auf Fläche in Kaderfarbe, daneben die wichtigsten Fähigkeiten als Balken
    const sk = startSkills(p);
    const keys = [...GROUP_SKILLS[sector], ...(["setPieces", "passing", "playmaking", "defending"] as DevSkill[]).filter((k) => !GROUP_SKILLS[sector].includes(k))].slice(0, 4);
    const bars = keys
      .map((k) => `<span class="pb${k === TRAININGS[state.hrf!.team.trainingType]?.skill ? " tr" : ""}"><span class="pb-bar"><i style="width:${Math.min(100, (sk[k] / 20) * 100).toFixed(1)}%"></i><b>${DEV_SKILL_DE[k]}</b></span><span class="pb-v">${Math.floor(sk[k])}</span></span>`)
      .join("");
    const tier = tierOf(p.id) ?? "R";
    return `<div class="pchip ht tier-${tier}${off ? " off" : ""}${tf >= 1 ? " tr-done" : tf > 0 ? " tr-half" : state.week ? " tr-open" : ""}${pick?.kind === "pool" && pick.id === p.id ? " picked" : ""}" ${off || !state.editMode ? "" : `draggable="true"`} data-pid="${p.id}">
      <span class="pc-tile token av tk-${tier}">${tokenFace(p)}${shirtNo(p) ? `<span class="no">${shirtNo(p)}</span>` : ""}</span>
      <span class="pc-main"><span class="pc-line"><span class="n">${esc(p.name)}</span><span class="muted">${p.age} J. <button type="button" class="pinfo" data-detail="${p.id}" title="Details zu ${esc(p.name)}" aria-label="Details zu ${esc(p.name)}">i</button></span></span>
      <span class="pc-bars">${bars}</span>
      <span class="m">${g} ${m.value.toFixed(1)} · Form ${p.form} · Kond. ${p.stamina}${st}</span></span></div>`;
  };
  const out: string[] = [];
  const shown = new Set<number>();
  for (const g of groups) {
    // Bankspieler stehen schon unter dem Feld, deshalb hier nicht noch einmal
    const ms = g.members.filter((m) => m.home && !onField.has(m.player.id) && !benchIds.has(m.player.id) && !unavailable(m.player) && !(state.hideTrained && trained(m.player.id) >= 1));
    if (!ms.length) continue;
    out.push(`<h4>${esc(g.name)}</h4>${ms.map((m) => chip(m, GROUP_SHORT[g.group], g.group)).join("")}`);
    ms.forEach((m) => shown.add(m.player.id));
  }
  const off = groups.flatMap((g) => g.members.filter((m) => m.home && unavailable(m.player)).map((m) => chip(m, GROUP_SHORT[g.group], g.group)));
  if (off.length) out.push(`<h4>Nicht einsetzbar</h4>${off.join("")}`);
  const benchCount = [...benchIds].filter((id) => id && !onField.has(id)).length;
  const rest = state.hrf!.players.filter((p) => !onField.has(p.id) && !benchIds.has(p.id)).length;
  const fullyTrained = state.hrf!.players.filter((p) => trained(p.id) >= 1).length;
  const hidden = state.hideTrained ? state.hrf!.players.filter((p) => !onField.has(p.id) && !benchIds.has(p.id) && !unavailable(p) && trained(p.id) >= 1).length : 0;
  const w = state.week?.window;
  const since = w ? w.start.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }) : "";
  const count = fullyTrained
    ? `${fullyTrained} haben seit ${since} schon voll trainiert${hidden ? `, ${hidden} ausgeblendet` : ""}`
    : `seit dem Trainingsupdate ${since} noch kein Spiel, daher niemand`;
  const why = `Zählt nur Spiele, die seit dem letzten Trainingsupdate (${since}) schon gespielt wurden. Die Aufstellung hier und das geplante Freundschaftsspiel zählen erst, wenn sie gespielt sind.`;
  const filter = state.week
    ? `<label class="trfilter" title="${esc(why)}"><input type="checkbox" id="hideTrained"${state.hideTrained ? " checked" : ""}> Schon trainierte ausblenden <span class="muted">(${count})</span></label>`
    : "";
  return `<div class="sub" style="margin-bottom:6px">Nicht aufgestellt (${rest}) · ${benchCount} auf der Bank. ${state.editMode ? "Hierher ziehen = vom Feld oder von der Bank nehmen." : "Antippen zeigt die Karte. Zum Aufstellen oben auf „Ändern“ schalten."}</div>${filter}${out.join("") || "<p class='sub'>Alle Spieler sind aufgestellt.</p>"}`;
}

function renderExplain() {
  const L = state.league!;
  const mine = manualEval();
  const E = explain({ positions: L.lineup.positions, ratings: L.ratings, hatStats: L.hatStats }, { positions: state.manual, ...mine }, state.hrf!.players, state.hrf!.team.formationExperience);
  const d = E.hatStatsMine - E.hatStatsAuto;
  const arrow = (v: number) => (Math.abs(v) < 0.05 ? `<span class="muted">±0</span>` : `<span class="delta ${v > 0 ? "up" : "down"}">${v > 0 ? "▲ +" : "▼ "}${de(v)}</span>`);
  $("#lineupWarn").innerHTML = E.warnings.length
    ? `<div class="warnbar">${E.warnings.map((w) => `<div><b>!</b> ${esc(w)}</div>`).join("")}</div>`
    : "";
  const changedRows = E.sectors.filter((x) => Math.abs(x.delta) >= 0.05);
  const changeBlock = E.same
    ? `<div class="focus ok"><b>Entspricht dem automatischen Vorschlag.</b></div>`
    : `<div class="focus ${d >= 0 ? "ok" : ""}"><b>Deine Aufstellung: ${E.hatStatsMine.toFixed(0)} HatStats</b>, automatisch ${E.hatStatsAuto.toFixed(0)} (${d >= 0 ? "+" : ""}${d.toFixed(0)}). ${
        E.formationMine !== E.formationAuto ? `Formation ${formationLabel(E.formationMine)} statt ${formationLabel(E.formationAuto)}.` : ""
      }</div>
      ${changedRows.length ? `<table class="cmp"><thead><tr><th>Mannschaftsteil</th><th class="num">Automatisch</th><th class="num">Deine</th><th class="num">Änderung</th></tr></thead><tbody>
        ${changedRows.map((x) => `<tr title="${esc(ratingLabel(x.mine))}"><td>${esc(x.name)}</td><td class="num">${de(x.auto)}</td><td class="num">${de(x.mine)}</td><td class="num">${arrow(x.delta)}</td></tr>`).join("")}
      </tbody></table>` : ""}
      ${E.changes.length ? `<ul>${E.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}`;
  const S = settingsEffect(state.manual, playersById(), state.settings, teamState());
  const sBig = S.sectors.filter((x) => Math.abs(x.delta) >= 0.05);
  const dh = S.hatStatsNow - S.hatStatsBase;
  const loddar = Math.abs(S.loddarNow - S.loddarBase) >= 0.05 ? `, <abbr title="LoddarStats (aus HO) gewichten wie HatStats die Mannschaftsteile, berücksichtigen aber auch, wohin die Angriffe laufen und die Konterstärke. Höher ist besser.">LoddarStats</abbr> ${de(S.loddarNow, 1)} statt ${de(S.loddarBase, 1)}` : "";
  const settingsBlock = S.changed.length
    ? `<h3 style="margin-top:0">Wirkung von Taktik und Einstellung</h3>
       <div class="focus ${dh >= 0 && S.loddarNow >= S.loddarBase ? "ok" : ""}"><b>${esc(S.changed.join(", "))}</b> gegenüber Normal: HatStats ${S.hatStatsNow.toFixed(0)} statt ${S.hatStatsBase.toFixed(0)} (${dh >= 0 ? "+" : ""}${dh.toFixed(0)})${loddar}.</div>
       ${sBig.length ? `<p>${sBig.map((x) => `<b>${esc(x.name)}</b> ${x.delta > 0 ? "+" : ""}${de(x.delta)}`).join(", ")}.</p>` : ""}
       <ul>${S.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`
    : "";
  $("#explainOut").innerHTML = `<div class="explain">
    ${settingsBlock}
    <h3${settingsBlock ? "" : ' style="margin-top:0"'}>Was sich gegenüber dem Vorschlag ändert</h3>
    ${changeBlock}
  </div>`;
}

let planKey = "";
let planCache: { plan: MatchPlan; oppLabel: string } | null = null;

/** Gegner für die Vorhersage: Profil aus dem Gegnercheck, sonst typischer Ligagegner aus allen bekannten Spielen */
function planOpponent(): { ratings: SectorRatings; tactic: number; label: string; known: boolean } | null {
  const O = state.opponent;
  const m = state.match;
  const teamId = state.hrf!.team.teamId;
  const name = m ? (m.homeId === teamId ? m.awayName : m.homeName) : "Gegner";
  if (O) return { ratings: O.average, tactic: O.tactic, label: `${name} (Ø aus ${O.matches.length} Spielen)`, known: true };
  // nur Teams der eigenen Liga, sonst verzerren Gegner aus anderen Ligen (z. B. aus dem Gegnercheck) den Schnitt
  const league = new Set(state.ho ? standings(state.ho).map((t) => t.teamId) : []);
  const rs = (state.ho?.matchRatings ?? []).filter((r) => r.teamId !== teamId && r.type === 1 && league.has(r.teamId));
  // erst ab drei verschiedenen Ligateams ist der Schnitt aussagekräftig
  if (new Set(rs.map((r) => r.teamId)).size < 3) return null;
  const avg = {} as SectorRatings;
  for (const k of RATING_SECTORS) avg[k] = rs.reduce((a, r) => a + r.ratings[k], 0) / rs.length;
  return { ratings: avg, tactic: Tactic.normal, label: `typischer Gegner deiner Liga (keine Daten zu ${name})`, known: false };
}

function styleNoteFor(t: Hrf["team"]): string {
  const [lo, hi] = styleRange(t);
  const coach = t.trainerType === 2 ? "einem ausgeglichenen Trainer" : t.trainerType === 0 ? "einem defensiven Trainer" : "einem offensiven Trainer";
  return lo === hi
    ? `Ausrichtung: Mit ${coach} und ohne Taktik-Assistenten ist nur ${styleName(lo)} möglich. Jede Stufe Taktik-Assistent erweitert den Spielraum.`
    : `Ausrichtung: Mit ${coach} und Taktik-Assistenten Stufe ${t.tacticalAssistants} sind nur ${styleName(lo)} bis ${styleName(hi)} möglich.`;
}

function renderMatchPlan() {
  if (!state.hrf) return;
  const set = (id: string, html: string) => ($(id).innerHTML = html);
  const positions = state.manual.length === 11 ? state.manual : (state.league?.lineup.positions ?? []);
  const m = state.match;
  const oppName = m ? (m.homeId === state.hrf.team.teamId ? m.awayName : m.homeName) : "den Gegner";
  const opp = positions.length < 11 ? null : planOpponent();
  const s = state.settings;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const bar = (pr: MatchPlan["best"]["prediction"]) =>
    `<div class="wdl" title="Sieg ${pct(pr.win)}, Remis ${pct(pr.draw)}, Niederlage ${pct(pr.loss)}"><i class="w" style="width:${pr.win * 100}%"></i><i class="d" style="width:${pr.draw * 100}%"></i><i class="l" style="width:${pr.loss * 100}%"></i></div>
     <div class="sub">Sieg <b>${pct(pr.win)}</b> · Remis ${pct(pr.draw)} · Niederlage ${pct(pr.loss)} · Tore ${de(pr.goalsFor, 1)} : ${de(pr.goalsAgainst, 1)} · ${de(pr.points)} erwartete Punkte</div>`;
  if (!opp) {
    planKey = "";
    set("#planOpp", `gegen ${esc(oppName)}`);
    set("#planWarn", "");
    set("#planCur", "");
    set(
      "#planReco",
      positions.length < 11
        ? `<div class="mp-head">Empfehlung</div><p class="sub">Erst 11 Spieler aufstellen, dann rechnet TopHatt die beste Taktik aus.</p>`
        : `<div class="mp-head">Empfehlung</div><p><b>Keine Empfehlung möglich:</b> Die Stärke von ${esc(oppName)} ist unbekannt. Bis dahin ist Normal, ausgewogen, Einstellung Normal die sichere Wahl.</p>
           <p class="sub">So bekommst du eine: in HO den Gegnercheck für ${esc(oppName)} machen, TopHatt.bat starten und „Aktualisieren“ klicken.</p>`,
    );
    set("#planNotes", "");
    set("#planMore", "");
    return;
  }
  const byId = playersById();
  const oppSide = { ratings: opp.ratings, tactic: opp.tactic, level: 8 };
  const key = JSON.stringify([positions.map((p) => [p.playerId, p.role, p.behaviour]), s.location, opp.label, opp.ratings, styleRange(state.hrf.team)]);
  if (key !== planKey) {
    planKey = key;
    const cup = m ? m.type === 3 : false;
    planCache = { plan: planMatch(positions, byId, s, teamState(), oppSide, { cup, styleRange: styleRange(state.hrf.team) }), oppLabel: opp.label };
  }
  const { plan: P } = planCache!;
  const b = P.best;
  const cur = (MODELLED_TACTICS as number[]).includes(s.tactic) ? evaluateSettings(positions, byId, s, teamState(), oppSide) : null;
  const isActive = (o: MatchPlan["options"][number]) => o.settings.tactic === s.tactic && o.settings.styleOfPlay === s.styleOfPlay;
  const reco = { tactic: b.settings.tactic, style: b.settings.styleOfPlay, attitude: P.attitude.advice };
  const applied = s.tactic === reco.tactic && s.styleOfPlay === reco.style && s.attitude === reco.attitude;
  const recoPred = reco.attitude === 0 ? b.prediction : evaluateSettings(positions, byId, { ...b.settings, attitude: reco.attitude as MatchSettings["attitude"] }, teamState(), oppSide).prediction;
  set("#planOpp", `gegen ${esc(oppName)} · Gegnerstärke: ${opp.known ? `Durchschnitt seiner letzten ${state.opponent?.matches.length ?? 5} Spiele` : "Schnitt deiner Liga (geschätzt)"}`);
  set("#planWarn", opp.known ? "" : `<p class="sub warn-note">Zu ${esc(oppName)} gibt es keine Daten. Für eine echte Empfehlung in HO den Gegnercheck machen und „Aktualisieren“ klicken.</p>`);
  set("#planCur", cur ? bar(cur.prediction) : `<div class="wdl"><i style="width:100%;background:var(--line)"></i></div><div class="sub">Keine Prognose für ${esc(TACTIC_NAME[s.tactic])}: diese Taktik bildet das Spielmodell nicht ab.</div>`);
  if (applied) {
    set("#planReco", `<div class="mp-head">Empfehlung</div><p class="mp-ok">✓ Deine Einstellung ist die beste berechnete Variante.</p>`);
  } else {
    const diffs: string[] = [];
    if (s.tactic !== reco.tactic) diffs.push(`Taktik <b>${esc(TACTIC_NAME[reco.tactic])}</b> statt ${esc(TACTIC_NAME[s.tactic])}`);
    if (s.styleOfPlay !== reco.style) diffs.push(`Ausrichtung <b>${esc(styleName(reco.style))}</b> statt ${esc(styleName(s.styleOfPlay))}`);
    if (s.attitude !== reco.attitude) diffs.push(`Einstellung <b>${esc(ATTITUDE_NAME[reco.attitude])}</b> statt ${esc(ATTITUDE_NAME[s.attitude])}`);
    const gain = cur ? recoPred.points - cur.prediction.points : null;
    set(
      "#planReco",
      `<div class="mp-head">Empfehlung${gain !== null && gain >= 0.005 ? ` <span class="up">+${de(gain)} erwartete Punkte</span>` : ""}</div>
       <ul class="mp-diff">${diffs.map((d) => `<li>${d}</li>`).join("")}</ul>
       ${bar(recoPred)}
       <button class="btn primary" id="applyPlan">Empfehlung übernehmen</button>`,
    );
  }
  const notes = [...P.notes.filter((n) => !/^Gegenüber|^Normal und ausgewogen/.test(n)), P.attitude.text];
  set("#planNotes", notes.map((t) => `<li>${esc(t)}</li>`).join(""));
  const row = (o: MatchPlan["options"][number]) =>
    `<tr class="${o === b ? "reco-row" : ""} ${isActive(o) ? "active-row" : ""}"><td>${esc(o.label)}${o === b ? ' <span class="mp-tag reco">empfohlen</span>' : ""}${isActive(o) ? ' <span class="mp-tag act">eingestellt</span>' : ""}</td><td class="num">${pct(o.prediction.win)}</td><td class="num">${pct(o.prediction.draw)}</td><td class="num">${pct(o.prediction.loss)}</td><td class="num">${de(o.prediction.goalsFor, 1)} : ${de(o.prediction.goalsAgainst, 1)}</td><td class="num">${de(o.prediction.points)}</td><td class="num">${o.hatStats.toFixed(0)}</td></tr>`;
  set(
    "#planMore",
    P.options.length > 1
      ? `<details><summary>Alle Varianten vergleichen (${P.options.length})</summary>
      <div class="scroll"><table class="nowrap mp-table"><thead><tr><th>Taktik, Ausrichtung</th><th class="num">Sieg</th><th class="num">Remis</th><th class="num">Niederl.</th><th class="num">Tore</th><th class="num">Erw. Punkte</th><th class="num">HatStats</th></tr></thead><tbody>${P.options.map(row).join("")}</tbody></table></div>
      <p class="sub">Berechnet mit HOs Spielvorhersage (10 Angriffe, Ballbesitz aus dem Mittelfeld, Torchance aus Angriff gegen Abwehr, Konter), je 3000 simulierte Spiele, alle mit Einstellung Normal.</p>
    </details>`
      : "",
  );
  document.querySelector("#applyPlan")?.addEventListener("click", () => {
    $<HTMLSelectElement>("#tactic").value = String(reco.tactic);
    $<HTMLSelectElement>("#style").value = String(reco.style);
    $<HTMLSelectElement>("#attitude").value = String(reco.attitude);
    compute();
    toast("Empfohlene Einstellungen übernommen.");
  });
}

function renderLineup() {
  tierCache = null;
  const L = state.league;
  if (!L) return;
  const byId = playersById();
  const m = state.match;
  $("#lineupSub").textContent = m ? `für ${fmtDate(m.date)} gegen ${m.homeId === state.hrf!.team.teamId ? m.awayName : m.homeName}` : "";
  const prev = tokenRects();
  renderFormationPick();
  const t = TRAININGS[state.hrf!.team.trainingType];
  renderMatchPlan();
  $("#pitchOut").innerHTML = editPitch();
  $("#poolOut").innerHTML = poolHtml();
  renderInspect();
  animateTokens(prev);
  drawFlow();
  setTimeout(drawFlow, 450);
  renderExplain();
  const C = myLineup();
  const mine = manualEval();
  const ch = state.choices;
  const who = (id: number, own: boolean) => `${esc(byId.get(id)?.name ?? "-")} <span class="muted">(${own ? "von dir" : "automatisch"})</span>`;
  const anyOwn = !!(ch.captainId && C.captainId === ch.captainId) || !!(ch.setPiecesId && C.setPiecesId === ch.setPiecesId) || Object.keys(ch.bench ?? {}).length > 0;
  const benchCount = Object.values(C.bench).filter(Boolean).length;
  const tl = tacticLevel(state.manual.filter((p) => byId.has(p.playerId)).map((p) => ({ player: byId.get(p.playerId)!, role: p.role })), state.settings.tactic);
  $("#lineupSide").innerHTML = `
    <h3 style="margin-top:0">Kapitän, Standards, Bank</h3>
    <table><tbody>
      <tr><td class="muted">Kapitän</td><td>${who(C.captainId, C.captainId === ch.captainId)}</td></tr>
      <tr><td class="muted">Standards</td><td>${who(C.setPiecesId, C.setPiecesId === ch.setPiecesId)}</td></tr>
      <tr><td class="muted">Ersatzbank</td><td>${benchCount} von 7 Plätzen besetzt${Object.keys(ch.bench ?? {}).length ? ` <span class="muted">(${Object.keys(ch.bench!).length} von dir)</span>` : ""}</td></tr>
      <tr><td class="muted">Reserve, Elfmeter, Anweisungen</td><td><span id="ordersInfo">${ordersSummary(C, byId)}</span> · <button class="linkbtn" data-goto="ordersArea">ändern</button></td></tr>
      <tr><td class="muted"><abbr title="LoddarStats (aus HO) gewichten wie HatStats die Mannschaftsteile, berücksichtigen aber auch, wohin die Angriffe laufen und die Konterstärke. Höher ist besser.">LoddarStats</abbr></td><td>${de(loddarStats(mine.ratings, state.settings.tactic, tl), 1)}</td></tr>
    </tbody></table>
    <p class="sub">Spieler auf dem Feld antippen, um Kapitän und Standards zu setzen. Die Bank stellst du unter dem Feld zusammen. Alles hier landet zusammen in einer HRF-Datei für HO.</p>
    ${anyOwn ? `<button class="btn" id="choicesReset">Kapitän, Standards und Bank wieder automatisch</button>` : ""}`;
  const mi = Number($<HTMLInputElement>("#matchId").value);
  renderOrdersPage();
  $("#matchIdInfo").textContent = m && mi === m.id ? `Spiel-ID gehört zu: ${fmtDate(m.date)} gegen ${m.homeId === state.hrf!.team.teamId ? m.awayName : m.homeName}` : mi ? "Spiel-ID von Hand eingetragen." : "";
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
  refreshFriendly();
  renderFriendly();
}

function initWeakness() {
  $("#weakBasis").addEventListener("change", () => {
    state.weakBasis = $<HTMLSelectElement>("#weakBasis").value;
    updateAnalysis();
    render();
  });
  $("#weakOut").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-weakbasis]");
    if (!b) return;
    state.weakBasis = b.dataset.weakbasis!;
    updateAnalysis();
    render();
    $("#schwachstellen").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function setBenchEmpty(slot: BenchSlot) {
  state.choices = { ...state.choices, bench: { ...(state.choices.bench ?? {}), [slot]: 0 } };
  editorChanged();
}

/** Knöpfe in der Spielerkarte */
// --- Spielerkarte neben dem Feld --------------------------------------------------------
// Maus darüber: Vorschau mit Linien · Klick: festgehalten mit Aktionen · Ziehen: nur Linien · Handy: Blatt von unten

const STAR = "★";
/** Rückennummer; Hattrick nutzt 100 für „keine“ */
const shirtNo = (p: Player) => (p.number && p.number > 0 && p.number < 100 ? p.number : 0);
let inspectKey = "";

/** Was die Karte gerade zeigt: festgehaltener Spieler (Auswahl) oder Vorschau */
function inspectTarget(): { pid: number; pinned: boolean; pick: Pick } | null {
  if (state.dragging || !state.hrf) return null;
  const pick = state.pick;
  if (pick?.kind === "slot") {
    const pid = state.manual.find((x) => x.role === pick.role)?.playerId;
    return pid ? { pid, pinned: true, pick } : null;
  }
  if (pick?.kind === "bench") return { pid: myLineup().bench[pick.slot] ?? 0, pinned: true, pick };
  if (pick?.kind === "pool") return { pid: pick.id, pinned: true, pick };
  if (state.inspectPreview) return { pid: state.inspectPreview, pinned: false, pick: null };
  return null;
}
type Pick = (typeof state)["pick"];

function renderInspect() {
  const box = document.querySelector<HTMLElement>("#inspectOut");
  const ed = document.querySelector<HTMLElement>("#aufstellung .editor");
  if (!box || !ed) return;
  const t = inspectTarget();
  const key = t ? `${t.pinned ? "p" : "v"}:${JSON.stringify(t.pick)}:${t.pid}` : "";
  if (t?.pinned && key !== inspectKey) {
    state.inspectTab = "card";
    // Handy: erst klein (Feld bleibt sichtbar), Griff oben vergrößert
    state.inspectSmall = window.matchMedia("(max-width:860px)").matches;
  }
  inspectKey = key;
  if (!t) {
    box.hidden = true;
    box.innerHTML = "";
    ed.classList.remove("inspecting");
    document.body.classList.remove("inspect-open");
    return;
  }
  const list = t.pinned && state.inspectTab === "list";
  const tabs = t.pinned
    ? `<div class="ic-tabs" role="tablist"><button type="button" data-itab="card" aria-pressed="${!list}">Spielerkarte</button><button type="button" data-itab="list" aria-pressed="${list}">Liste der Spieler</button></div>`
    : "";
  box.hidden = false;
  box.classList.toggle("listmode", list);
  box.classList.toggle("small", state.inspectSmall);
  box.innerHTML = tabs + (list ? "" : inspectCardHtml(t.pid, t.pinned, t.pick));
  ed.classList.toggle("inspecting", !list);
  document.body.classList.toggle("inspect-open", t.pinned && !list && window.matchMedia("(max-width:860px)").matches);
}

function inspectCardHtml(pid: number, pinned: boolean, pick: Pick): string {
  const hrf = state.hrf!;
  const p = playersById().get(pid);
  const handle = `<button type="button" class="ic-handle" data-ismall aria-label="${state.inspectSmall ? "Karte vergrößern" : "Karte verkleinern"}"><i></i></button>`;
  if (!p) {
    // leerer Bankplatz
    if (pick?.kind !== "bench") return "";
    const own = pick.slot in (state.choices.bench ?? {});
    return `${handle}<div class="ic-top"><div class="ic-id"><h4>Platz frei</h4><div class="ic-sub">Bank: ${BENCH_DE[pick.slot]}</div></div><button type="button" class="ic-pin on pm-close" aria-label="Schließen">× schließen</button></div>
      ${own ? `<div class="ic-act"><button data-bench-auto="${pick.slot}">Automatisch wählen</button></div>` : ""}
      <div class="ic-tip" style="padding-top:8px">Spieler aus der Liste antippen: kommt auf diesen Platz.</div>`;
  }
  const t = TRAININGS[hrf.team.trainingType];
  const tier = tierOf(p.id) ?? "R";
  const onField = state.manual.find((x) => x.playerId === p.id);
  const C = myLineup();
  const bench = (Object.keys(C.bench) as BenchSlot[]).find((k) => C.bench[k] === p.id);
  const where = onField ? ROLE_DE[onField.role] : bench ? `Bank: ${BENCH_DE[bench]}` : "nicht aufgestellt";
  const pin = pinned
    ? `<button type="button" class="ic-pin on pm-close" title="Karte schließen (Esc)">📌 festgehalten ×</button>`
    : `<span class="ic-pin" title="Spieler anklicken, um die Karte festzuhalten">Vorschau</span>`;
  const lvl = (v: number) => (v >= 7 ? "" : v >= 5 ? "y" : "r");
  const bar = (v: number, max: number, cls = "") => `<span class="ic-bar"><i class="${cls}" style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%"></i></span>`;

  const chips: string[] = [];
  const wk = state.week?.played.get(p.id);
  const wf = weekFactor(wk);
  if (t && wf >= 1) chips.push(`<span>✓ diese Woche ${esc(t.name)} trainiert</span>`);
  else if (t && wf > 0) chips.push(`<span class="w">½ diese Woche ${esc(t.name)}</span>`);
  if (p.injury > 0) chips.push(`<span class="b">verletzt, ${p.injury} ${p.injury === 1 ? "Woche" : "Wochen"}</span>`);
  else if (p.injury === 0) chips.push(`<span class="w">angeschlagen</span>`);
  if (p.cards >= 3) chips.push(`<span class="b">gesperrt</span>`);
  else if (p.cards > 0) chips.push(`<span class="w">${p.cards} ${p.cards === 1 ? "Gelbe Karte" : "Gelbe Karten"}</span>`);
  if (C.captainId === p.id) chips.push(`<span>Kapitän</span>`);
  if (C.setPiecesId === p.id) chips.push(`<span>Standards</span>`);

  const start = startSkills(p);
  const skills: DevSkill[] = ["keeper", "defending", "playmaking", "winger", "passing", "scoring", "setPieces"];
  const trained = t?.skill;
  const skillRows = [...skills]
    .sort((a, b) => (a === trained ? -1 : b === trained ? 1 : start[b] - start[a]))
    .map((k) => {
      const v = start[k];
      return `<div class="ic-sk${k === trained ? " tr" : ""}"><span>${DEV_SKILL_DE[k]}</span>${bar(v, 20)}<span class="n">${deNum(v, Number.isInteger(v) ? 0 : 1)}</span><span class="w">${skillName(v)}</span></div>`;
    })
    .join("");

  const { cands, best } = flowCands(p, onField?.role);
  const posChips = [
    onField ? `<b class="here" title="spielt hier">${ROLE_DE[onField.role]} ${deNum(playerPositionRating(p, onField.role, onField.behaviour))} · spielt hier</b>` : "",
    ...cands.slice(0, onField ? 4 : 5).map((c) => `<b class="${flowClass(c.rel / best)}">${ROLE_DE[c.role]} ${deNum(c.val)}</b>`),
  ].join("");

  const last =
    p.lastMatchDate && (p.lastMatchMinutes ?? 0) > 0
      ? `${p.lastMatchRating ? `<span class="stars" aria-label="${deNum(p.lastMatchRating)} Sterne">${STAR.repeat(Math.max(1, Math.floor(p.lastMatchRating)))}${p.lastMatchRating % 1 ? "½" : ""}</span><b>${deNum(p.lastMatchRating)}</b>` : ""}<span>${new Date(p.lastMatchDate.replace(" ", "T")).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${esc(positionShort(p.lastMatchPosition) || "–")} · ${p.lastMatchMinutes} Min.</span>`
      : `<span class="muted">kein Spiel bekannt</span>`;

  let actions = "";
  if (pinned && !state.editMode) {
    actions = `<div class="ic-act"><button data-detail="${p.id}">Ganze Entwicklung →</button><button data-setmode="edit">✎ Ändern einschalten</button></div>
      <div class="ic-tip ic-more">Ansehen: einen anderen Spieler antippen zeigt seine Karte. Zum Setzen, Tauschen, Verhalten oder Kapitän auf „Ändern“ schalten.</div>`;
  } else if (pinned && pick?.kind === "slot" && onField) {
    const opts = behavioursFor(pick.role);
    actions = `<div class="ic-act">
      ${opts.length > 1 ? `<span class="lbl">Verhalten</span>${opts.map((b) => `<button data-bh="${b}" aria-pressed="${b === onField.behaviour}">${BEHAVIOUR_DE[b] || "normal"}</button>`).join("")}<span class="lbl">Aktionen</span>` : ""}
      <button data-cap="${p.id}" aria-pressed="${C.captainId === p.id}">${C.captainId === p.id ? "✓ Kapitän" : "Zum Kapitän"}</button>
      <button data-sp="${p.id}" aria-pressed="${C.setPiecesId === p.id}">${C.setPiecesId === p.id ? "✓ Standards" : "Standards schießen"}</button>
      <button class="pm-out" data-remove="${pick.role}">Vom Feld nehmen</button>
      <button data-detail="${p.id}">Ganze Entwicklung →</button></div>
      <div class="ic-tip ic-more">Zum Tauschen eine andere Position oder einen Bankplatz antippen, oder einen Spieler aus der Liste wählen.</div>`;
  } else if (pinned && pick?.kind === "bench") {
    const own = pick.slot in (state.choices.bench ?? {});
    actions = `<div class="ic-act">${own ? `<button data-bench-auto="${pick.slot}">Automatisch wählen</button>` : ""}<button data-bench-empty="${pick.slot}">Platz leer lassen</button><button data-detail="${p.id}">Ganze Entwicklung →</button></div>
      <div class="ic-tip ic-more">Position auf dem Feld antippen: er spielt dort von Anfang an. Einen Spieler aus der Liste wählen: er kommt auf diesen Platz.</div>`;
  } else if (pinned) {
    actions = `<div class="ic-act"><button data-detail="${p.id}">Ganze Entwicklung →</button></div>
      <div class="ic-tip ic-more">Position oder Bankplatz antippen, um ihn dorthin zu setzen. Die Linien zeigen, wo er am besten passt.</div>`;
  }

  return `${handle}<div class="ic-top"><div class="ic-av tk-${tier}">${avatarHtml(p.id, state.ho?.avatars, shirtNo(p))}</div>
      <div class="ic-id"><h4>${shirtNo(p) ? `<small>${shirtNo(p)}</small>` : ""}${esc(p.name)}</h4>
        <div class="ic-sub">${p.age} Jahre, ${p.ageDays} Tage · ${esc(where)} · ${TIER_NAME[tier]}</div>
        <div class="ic-kv"><span>TSI <b>${p.tsi.toLocaleString("de-DE")}</b></span><span>Gehalt <b>${p.salary.toLocaleString("de-DE")} €</b></span><span>Erfahrung <b>${p.experience}</b> · Führung <b>${p.leadership}</b></span>${p.specialtyLabel ? `<span>✦ <b>${esc(p.specialtyLabel)}</b></span>` : ""}</div>
      </div>${pin}</div>
    <div class="ic-fk"><span>Form</span>${bar(p.form, 8, lvl(p.form))}<b>${p.form} ${skillName(p.form)}</b><span>Kondition</span>${bar(p.stamina, 9, lvl(p.stamina))}<b>${p.stamina} ${skillName(p.stamina)}</b></div>
    ${chips.length ? `<div class="ic-chips">${chips.join("")}</div>` : ""}
    <div class="ic-more">
    <div class="ic-sec"><h5>Fähigkeiten</h5>${skillRows}</div>
    ${posChips ? `<div class="ic-sec"><h5>Passt am besten · gleiche Farben wie die Linien</h5><div class="ic-pos">${posChips}</div></div>` : ""}
    <div class="ic-sec ic-last"><span class="muted">Letzte Bewertung</span>${last}</div>
    </div>
    ${actions}`;
}

function inspectClick(el: HTMLElement) {
  const sm = el.closest<HTMLElement>("[data-setmode]");
  if (sm) return setEditMode(sm.dataset.setmode === "edit");
  const tab = el.closest<HTMLElement>("[data-itab]");
  if (tab) {
    state.inspectTab = tab.dataset.itab === "list" ? "list" : "card";
    renderInspect();
    drawFlow();
    return;
  }
  if (el.closest("[data-ismall]")) {
    state.inspectSmall = !state.inspectSmall;
    renderInspect();
    return;
  }
  // Klick auf die Vorschau hält den Spieler fest
  if (!state.pick && state.inspectPreview) {
    const pid = state.inspectPreview;
    const pos = state.manual.find((x) => x.playerId === pid);
    const b = (Object.keys(myLineup().bench) as BenchSlot[]).find((k) => myLineup().bench[k] === pid);
    state.inspectPreview = null;
    state.pick = pos ? { kind: "slot", role: pos.role } : b ? { kind: "bench", slot: b } : { kind: "pool", id: pid };
    return renderLineup();
  }
  menuClick(el);
}

/** Umschalter Ansehen/Ändern: im Ansehen-Modus kann ein Klick nichts verändern */
function setEditMode(on: boolean) {
  state.editMode = on;
  try {
    localStorage.setItem("tophatt.editMode", on ? "1" : "");
  } catch {
    /* ohne Speicher geht es auch */
  }
  renderModeBar();
  renderLineup();
}

function renderModeBar() {
  const box = document.querySelector<HTMLElement>("#modeSeg");
  if (!box) return;
  box.innerHTML = `<button type="button" data-setmode="view" class="${state.editMode ? "" : "on"}" aria-pressed="${!state.editMode}" title="Klick zeigt nur die Spielerkarte, nichts wird verändert">👁 Ansehen</button><button type="button" data-setmode="edit" class="${state.editMode ? "on" : ""}" aria-pressed="${state.editMode}" title="Klick setzt und tauscht Spieler, Ziehen ist erlaubt">✎ Ändern</button>`;
  document.querySelector("#aufstellung .editor")?.classList.toggle("editing", state.editMode);
  const hint = document.querySelector<HTMLElement>("#editorHint");
  if (hint)
    hint.textContent = state.editMode
      ? "Ändern: Spieler antippen, dann Ziel antippen, oder ziehen. Setzen und Tauschen ist aktiv."
      : "Ansehen: Maus auf einem Spieler zeigt seine Karte, Antippen hält sie fest. Nichts wird verändert.";
}

/** Maus über einem Spieler auf Feld oder Bank: nach kurzem Verweilen Vorschau und Linien */
function initInspectHover() {
  const out = $("#pitchOut");
  const canHover = () => window.matchMedia("(hover:hover) and (min-width:861px)").matches;
  let showT = 0,
    hideT = 0;
  const hide = () => {
    clearTimeout(showT);
    clearTimeout(hideT);
    hideT = window.setTimeout(() => {
      if (!state.inspectPreview || state.pick || document.querySelector("#inspectOut:hover")) return;
      state.inspectPreview = null;
      state.flowPid = null;
      renderInspect();
      drawFlow();
    }, 350);
  };
  out.addEventListener("mouseover", (e) => {
    if (!canHover() || state.pick || state.dragging) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(".pitch.edit .slot[data-pid] .token, .bench .bslot[data-pid] .token");
    if (!el) return hide();
    const pid = Number(el.closest<HTMLElement>("[data-pid]")!.dataset.pid);
    clearTimeout(hideT);
    if (state.inspectPreview === pid) return;
    clearTimeout(showT);
    showT = window.setTimeout(() => {
      if (state.pick || state.dragging) return;
      state.inspectPreview = pid;
      state.flowPid = pid;
      renderInspect();
      drawFlow();
    }, state.inspectPreview ? 60 : 320);
  });
  out.addEventListener("mouseleave", hide);
  $("#inspectOut").addEventListener("mouseleave", () => state.inspectPreview && hide());
  // Fokus mit der Tastatur zeigt dieselbe Vorschau nicht; Klick/Enter wählt den Spieler wie bisher
}

function menuClick(el: HTMLElement) {
  const b = el.closest<HTMLElement>("button");
  if (!b) return;
  const d = b.dataset;
  if (b.classList.contains("pm-close")) return clearFlow();
  if (d.remove) return removeRole(Number(d.remove));
  if (d.bh !== undefined && state.pick?.kind === "slot") {
    const role = state.pick.role;
    const pos = state.manual.find((x) => x.role === role);
    if (pos) pos.behaviour = Number(d.bh) as never;
    state.manualEdited = true;
    renderLineup();
    renderWeakness();
    return;
  }
  const keep = () => {
    state.manualEdited = true;
    renderLineup();
  };
  if (d.cap) {
    state.choices = { ...state.choices, captainId: Number(d.cap) };
    return keep();
  }
  if (d.sp) {
    state.choices = { ...state.choices, setPiecesId: Number(d.sp) };
    return keep();
  }
  if (d.benchAuto) {
    const bench = { ...(state.choices.bench ?? {}) };
    delete bench[d.benchAuto as BenchSlot];
    state.choices = { ...state.choices, bench };
    return editorChanged();
  }
  if (d.benchEmpty) return setBenchEmpty(d.benchEmpty as BenchSlot);
}

function initEditor() {
  initInspectHover();
  try {
    state.editMode = localStorage.getItem("tophatt.editMode") === "1";
  } catch {
    /* ohne Speicher: Ansehen */
  }
  renderModeBar();
  $("#modeSeg").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-setmode]");
    if (b) setEditMode(b.dataset.setmode === "edit");
  });
  const root = $("#aufstellung");
  const target = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>(".pitch.edit .slot, .bench .bslot, .pool");
  root.addEventListener("dragstart", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[draggable=true]");
    if (!el || !e.dataTransfer) return;
    if (!state.editMode) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", el.classList.contains("slot") ? `r:${el.dataset.role}` : el.classList.contains("bslot") ? `b:${el.dataset.bench}` : `p:${el.dataset.pid}`);
    requestAnimationFrame(() => el.classList.add("dragging"));
    state.flowPid = Number(el.dataset.pid) || null;
    // Beim Ziehen nur die Linien: Karte weg, Liste wieder sichtbar (Ablegen dort = vom Feld nehmen)
    state.dragging = true;
    state.inspectPreview = null;
    renderInspect();
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
    if (state.dragging) {
      state.dragging = false;
      renderInspect();
    }
    drawFlow();
  });
  $("#poolOut").addEventListener("scroll", () => drawFlow(), { passive: true });
  window.addEventListener("resize", () => drawFlow());
  root.addEventListener("drop", (e) => {
    // dragend kommt nicht mehr an, wenn das gezogene Element beim Neuzeichnen ersetzt wird
    state.flowPid = null;
    state.dragging = false;
    renderInspect();
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
    if (kind === "b") {
      const from = v as BenchSlot;
      if (t.classList.contains("pool")) return setBenchEmpty(from);
      if (t.classList.contains("bslot")) {
        const id = myLineup().bench[from];
        return id ? setBench(t.dataset.bench as BenchSlot, id) : undefined;
      }
      return benchToField(from, Number(t.dataset.role));
    }
    if (!n) return;
    if (t.classList.contains("pool")) {
      if (kind === "r") removeRole(n);
      return;
    }
    if (t.classList.contains("bslot")) {
      const pid = kind === "p" ? n : state.manual.find((x) => x.role === n)?.playerId;
      return pid ? setBench(t.dataset.bench as BenchSlot, pid) : undefined;
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
    if (el.closest("#modeSeg") || el.closest(".subpill")) return;
    if (el.closest("#choicesReset")) {
      state.choices = {};
      return editorChanged();
    }
    if (el.closest("#inspectOut")) return inspectClick(el);
    if (el.closest("select")) return;
    const chip = el.closest<HTMLElement>(".pchip");
    const slot = el.closest<HTMLElement>(".pitch.edit .slot");
    const bslot = el.closest<HTMLElement>(".bench .bslot");
    const pick = state.pick;
    state.flowPid = null;
    state.inspectPreview = null;
    if (!state.editMode && (bslot || chip || slot)) {
      // Ansehen: Klick wechselt nur die Karte, nichts wird gesetzt oder getauscht
      const next: typeof state.pick = bslot
        ? myLineup().bench[bslot.dataset.bench as BenchSlot]
          ? { kind: "bench", slot: bslot.dataset.bench as BenchSlot }
          : null
        : chip
          ? { kind: "pool", id: Number(chip.dataset.pid) }
          : slot!.dataset.pid
            ? { kind: "slot", role: Number(slot!.dataset.role) }
            : null;
      if (!next) {
        toast("Zum Aufstellen oben auf „Ändern“ umschalten.");
        return;
      }
      state.pick = JSON.stringify(next) === JSON.stringify(pick) ? null : next;
      return renderLineup();
    }
    if (bslot) {
      const b = bslot.dataset.bench as BenchSlot;
      if (pick?.kind === "pool") return setBench(b, pick.id);
      if (pick?.kind === "slot") {
        const pos = state.manual.find((x) => x.role === pick.role);
        if (pos) return setBench(b, pos.playerId);
      }
      if (pick?.kind === "bench" && pick.slot !== b) {
        const id = myLineup().bench[pick.slot];
        if (id) return setBench(b, id);
      }
      state.pick = pick?.kind === "bench" && pick.slot === b ? null : { kind: "bench", slot: b };
      return renderLineup();
    }
    if (chip) {
      const id = Number(chip.dataset.pid);
      if (chip.classList.contains("off")) return;
      if (pick?.kind === "slot") {
        const pos = state.manual.find((x) => x.role === pick.role);
        if (pos) return placePlayer(id, pick.role);
      }
      if (pick?.kind === "bench") return setBench(pick.slot, id);
      state.pick = pick?.kind === "pool" && pick.id === id ? null : { kind: "pool", id };
      return renderLineup();
    }
    if (slot) {
      const role = Number(slot.dataset.role);
      if (pick?.kind === "pool") return placePlayer(pick.id, role);
      if (pick?.kind === "bench") return benchToField(pick.slot, role);
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
    if (!state.editMode && el.closest(".pool")) return;
    if (el.closest(".pool") && pick?.kind === "slot") return removeRole(pick.role);
    if (el.closest(".pool") && pick?.kind === "bench") return setBenchEmpty(pick.slot);
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
  $("#autoFill").addEventListener("click", () => {
    if (!state.league) return;
    if (state.trainingMode) {
      state.trainingMode = false;
      state.formation = "";
    }
    state.manual = formationPositions();
    state.manualEdited = !!state.formation;
    state.pick = null;
    state.choices = {};
    renderLineup();
    toast(state.formation ? `Beste Elf für ${formationLabel(state.formation)} aufgestellt.` : "Feld automatisch aufgestellt.");
  });
  $("#formationPick").addEventListener("change", () => {
    state.formation = $<HTMLSelectElement>("#formationPick").value;
    if (state.trainingMode && state.week) return applyTrainingFormation(state.formation);
    state.manual = formationPositions();
    state.manualEdited = !!state.formation;
    state.pick = null;
    state.choices = {};
    renderLineup();
  });
  $("#trainingFill").addEventListener("click", () => {
    const hrf = state.hrf;
    const t = hrf && TRAININGS[hrf.team.trainingType];
    if (!hrf || !t || !state.week) return toast("Kein Training eingestellt.");
    state.trainingMode = true;
    state.formation = "";
    const plan = trainingPlan("");
    state.manual = plan.lineup.positions.map((p) => ({ ...p }));
    state.choices = {};
    editorChanged();
    toast(`Trainingself ${formationLabel(plan.lineup.formation)}: ${plan.gaining.length} Spieler bekommen dadurch „${t.name}“-Training. Formation wechseln behält den Modus bei.`);
  });
  $("#aufstellung").addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const card = el.closest<HTMLElement>(".tf-card[data-tf]");
    if (card) return applyTrainingFormation(card.dataset.tf!);
    const fc = el.closest<HTMLElement>(".tf-card[data-fc]");
    if (fc) {
      const sel = $<HTMLSelectElement>("#formationPick");
      sel.value = fc.dataset.fc!;
      sel.dispatchEvent(new Event("change"));
      return;
    }
    if (el.closest("#trainingOff")) $<HTMLButtonElement>("#autoFill").click();
  });
  $("#poolOut").addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== "hideTrained") return;
    state.hideTrained = el.checked;
    try {
      localStorage.setItem("tophatt.hideTrained", el.checked ? "1" : "");
    } catch {
      /* ohne Speicher geht es auch */
    }
    $("#poolOut").innerHTML = poolHtml();
    drawFlow();
  });
  try {
    state.hideTrained = localStorage.getItem("tophatt.hideTrained") === "1";
  } catch {
    /* ohne Speicher geht es auch */
  }
  $("#clearField").addEventListener("click", () => {
    state.trainingMode = false;
    state.manual = [];
    state.choices = {};
    editorChanged();
  });
}

const STATUS_LABEL = { critical: ["!", "Schwach"], warning: ["–", "Ausbaufähig"], good: ["✓", "Solide"], serious: ["↓", ""] } as const;
const statusChip = (cls: "good" | "warning" | "serious" | "critical", label: string, icon: string) => `<span class="status ${cls}"><i>${icon}</i>${esc(label)}</span>`;

/**
 * Schwachstellen, Verstärkungs-Hebel und Suchprofile für dieselbe Grundlage wie die Schwachstellen-Seite
 * (Standard: deine Aufstellung), damit Transfers und Schwachstellen zusammenpassen.
 */
function updateAnalysis() {
  const hrf = state.hrf;
  const B = weakBasis();
  if (!hrf || !B) return;
  const team = teamState();
  state.weak = assessSectors(hrf.players, { positions: B.positions } as Lineup, B.ratings, state.settings, team);
  const weakSet = new Set(state.weak.filter((w) => w.severity !== "good").map((w) => w.sector));
  const lineup = B.positions === state.league!.lineup.positions ? state.league!.lineup : { positions: B.positions, bench: completeLineup(B.positions, hrf.players, state.settings, $<HTMLInputElement>("#bruised").checked).bench };
  state.advice = advise(hrf.players, lineup, state.settings, team, hrf.team.trainingType, weakSet);
  // Kaderplanung auf derselben Grundlage wie die Schwachstellen (normalerweise deine Aufstellung)
  state.planBasis = B.label;
  state.plans = state.projection ? planSquad(hrf.players, { positions: B.positions }, state.projection) : [];
  state.profiles = searchProfiles(hrf.players, state.weak, state.plans);
}

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
  const W = state.weak;
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
  const backupHtml = (b: GroupPlan["horizons"][number]["backup"]) => {
    if (!b) return `<br><span class="down">Ersatz: keiner</span>`;
    const cls = b.share >= BACKUP_SHARE ? "muted" : "down";
    return `<br><span class="${cls}">Ersatz: ${esc(b.name.split(" ").slice(-1)[0])} (${b.value.toFixed(1)}, ${Math.round(b.share * 100)} %)</span>`;
  };
  const cell = (h: GroupPlan["horizons"][number], base: number, i: number) => {
    const diff = base ? h.average / base - 1 : 0;
    const trend = i === 0 || Math.abs(diff) < 0.03 ? "" : `<span class="${diff < 0 ? "down" : "up"}"> ${diff > 0 ? "+" : ""}${Math.round(diff * 100)} %</span>`;
    return `<td class="st"><span class="val">${h.average.toFixed(1)}</span>${trend}<br>${h.starters.map((e) => `${esc(e.name.split(" ").slice(-1)[0])} <span class="muted">${e.age}</span>`).join(", ")}${backupHtml(h.backup)}</td>`;
  };
  $("#planOut").innerHTML = `<div class="scroll"><table class="plan"><thead><tr><th>Mannschaftsteil</th><th>Jetzt</th><th>In 1 Saison</th><th>In 2 Saisons</th><th>Bewertung</th></tr></thead><tbody>
    ${P.map((g) => {
      const [icon, l] = label[g.severity];
      return `<tr><td><b>${esc(g.name)}</b><br><span class="muted">${g.needed} ${g.needed === 1 ? "Platz" : "Plätze"}</span></td>${g.horizons.map((h, i) => cell(h, g.horizons[0].average, i)).join("")}<td>${statusChip(g.severity, l, icon)}<br><span class="sub">${esc(g.note)}</span></td></tr>`;
    }).join("")}
    </tbody></table></div>
    <p class="sub">Berechnet nach ${esc(state.planBasis || "deiner Aufstellung")} (wie die Seite Schwachstellen): „Jetzt“ zeigt genau diese Stammspieler. Später bleiben sie auf ihren Plätzen, bis ein anderer Spieler dort stärker ist und als Nachfolger übernimmt. Der Trend in Prozent vergleicht mit „Jetzt“. Zahl = durchschnittliche Positionsstärke der Stammspieler (HO-Formel), Alter zum jeweiligen Zeitpunkt. Training und Altersabbau wie in der Spielerentwicklung; Form und Erfahrung bleiben gleich.</p>
    <p class="sub">Ersatz: je Mannschaftsteil einer, und jeder Spieler nur für einen Teil, wie auf der Bank. Prozent = Stärke im Vergleich zum schwächsten Stammspieler dort. Gleichwertig ab ${Math.round(BACKUP_SHARE * 100)} %, darunter rot. Verletzte und gesperrte Spieler zählen heute nicht.</p>`;
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

const SECTOR_TRAIN_DE: Record<string, string> = {
  goal: "Torwart",
  back: "Außenverteidiger",
  centralDefence: "Innenverteidiger",
  wing: "Flügel",
  innerMidfield: "zentrales Mittelfeld",
  forward: "Sturm",
};

function renderFriendly() {
  renderTrainingWeek();
}

// --- Trainingswoche (A-/B-Kader, Liga + zweites Spiel) -------------------------------------------------

const SQUAD_KEY = "tophatt.kader";
function loadOwnSquads(): Record<number, SquadTier> {
  try {
    const raw = localStorage.getItem(SQUAD_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}
function saveOwnSquads() {
  try {
    localStorage.setItem(SQUAD_KEY, JSON.stringify(state.squadOwn));
  } catch {
    /* ohne Speicher gilt die Zuordnung nur bis zum Neuladen */
  }
}

/** Ligaformation für die Woche: stärkste Elf, bei fast gleicher Stärke mehr Trainingsplätze */
function leagueChoice(): LeagueChoice | null {
  const hrf = state.hrf;
  const t = hrf && TRAININGS[hrf.team.trainingType];
  if (!hrf || !t || !state.formations.length) return null;
  return chooseLeagueFormation(state.formations, t, Number($<HTMLSelectElement>("#minExp").value));
}

/** Kaderzuordnung: Vorschlag (A = Ligaelf, B = Trainingsgruppe, Rest) plus eigene Änderungen */
function squadTiers(): Map<number, SquadTier> {
  const hrf = state.hrf;
  if (!hrf) return new Map();
  const t = TRAININGS[hrf.team.trainingType];
  const lc = leagueChoice();
  const ids = (lc ? lc.pick.positions : (state.league?.lineup.positions ?? [])).map((p) => p.playerId);
  return suggestSquads(hrf.players, ids, t, state.squadOwn);
}

/** Kaderzuordnung ohne eigene Änderungen (zum Vergleichen) */
function suggestedTiers(): Map<number, SquadTier> {
  const own = state.squadOwn;
  state.squadOwn = {};
  const s = squadTiers();
  state.squadOwn = own;
  return s;
}

let tierCache: Map<number, SquadTier> | null = null;
function tierOf(id: number): SquadTier | undefined {
  if (!tierCache) tierCache = squadTiers();
  return tierCache.get(id);
}
function tierBadge(id: number): string {
  const tier = tierOf(id);
  if (!tier) return "";
  return `<span class="kd kd-${tier}" title="${TIER_NAME[tier]}">${tier === "R" ? "–" : tier}</span>`;
}

/** Spiele in der laufenden Trainingswoche: Liga (Typ 1) und Pokal (Typ 3) */
function weekMatches(): { league: HoMatch | null; cup: HoMatch | null } {
  const w = state.week?.window;
  if (!w || !state.ho) return { league: null, cup: null };
  const inWeek = upcomingMatches(state.ho).filter((m) => m.date.getTime() < w.end.getTime());
  return { league: inWeek.find((m) => m.type === 1) ?? null, cup: inWeek.find((m) => m.type === 3) ?? null };
}

let cupTimer = 0;
/** Pokalvarianten im Hintergrund rechnen (dauert etwas) */
function scheduleCup() {
  const hrf = state.hrf;
  const { cup } = weekMatches();
  const t = hrf && TRAININGS[hrf.team.trainingType];
  if (!hrf || !cup || !t || !state.week) {
    state.cup = null;
    return;
  }
  const leagueIn = weekMatches().league;
  const before = addPlanned(state.week.played, leagueIn ? state.manual : [], t, "Liga");
  const key = `${cup.id}|${hrf.team.trainingType}|${state.manual.map((p) => `${p.role}:${p.playerId}`).join(",")}|${bruisedOk()}|${$<HTMLSelectElement>("#minExp").value}`;
  if (state.cup?.key === key) return;
  clearTimeout(cupTimer);
  cupTimer = window.setTimeout(() => {
    const teamId = hrf.team.teamId;
    const loc = cup.neutral ? Location.neutral : cup.homeId === teamId ? Location.home : Location.away;
    const settings: MatchSettings = { ...state.settings, location: loc as MatchSettings["location"], tactic: Tactic.normal, attitude: Attitude.normal };
    const oppId = cup.homeId === teamId ? cup.awayId : cup.homeId;
    const prof = state.ho ? opponentProfile(state.ho.matchRatings, oppId) : null;
    try {
      const plan = planCup(hrf.players, hrf.team.trainingType, before, settings, teamState(), {
        formationExperience: hrf.team.formationExperience,
        minExperience: Number($<HTMLSelectElement>("#minExp").value),
        allowBruised: bruisedOk(),
        opponent: prof ? { ratings: prof.average, tactic: prof.tactic, level: null } : null,
      });
      state.cup = { key, plan, opponent: cup.homeId === teamId ? cup.awayName : cup.homeName, known: !!prof };
      if (!state.cupPick || !plan.variants.some((v) => v.key === state.cupPick)) state.cupPick = plan.recommended;
    } catch {
      state.cup = null;
    }
    renderTrainingWeek();
  }, 60);
}

/** Aufstellung des zweiten Spiels: gewählte Pokalvariante oder Freundschaftsspiel */
function secondLineup(): { kind: "pokal" | "freundschaft"; lineup: Lineup } | null {
  const hrf = state.hrf;
  if (!hrf) return null;
  const { cup } = weekMatches();
  if (cup) {
    const v = state.cup?.plan.variants.find((x) => x.key === state.cupPick) ?? state.cup?.plan.variants.find((x) => x.key === state.cup?.plan.recommended);
    if (!v) return null;
    return { kind: "pokal", lineup: { ...completeLineup(v.positions, hrf.players, state.settings, bruisedOk()), formation: v.formation } };
  }
  return state.friendly ? { kind: "freundschaft", lineup: state.friendly.lineup } : null;
}

const dayTime = (d: Date) => d.toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayOnly = (d: Date) => d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

function renderTrainingWeek() {
  tierCache = null;
  scheduleCup();
  const hrf = state.hrf!;
  const t = TRAININGS[hrf.team.trainingType];
  const out = $("#friendlyOut");
  if (!t || !state.week) {
    out.innerHTML = `<p class="sub">In den HO-Daten ist kein Training eingestellt.</p>`;
    return;
  }
  const w = state.week.window;
  const { league, cup } = weekMatches();
  const byId = playersById();
  const lc = leagueChoice();
  const second = secondLineup();
  const leaguePositions = league ? state.manual : [];
  const tiers = squadTiers();
  tierCache = tiers;
  const rows = weekRows(hrf.players, tiers, t, state.week.played, leaguePositions, second?.lineup.positions ?? []);
  const fullCount = rows.filter((r) => r.factor >= 1).length;
  const halfCount = rows.filter((r) => r.factor > 0 && r.factor < 1).length;
  const maxFull = 2 * maxTrainingSlots(t).full;
  const list = (xs: string[]) => xs.map((x) => SECTOR_TRAIN_DE[x] ?? x).join(", ");
  $("#friendlySub").textContent = `Trainingswoche ${dayOnly(w.start)} bis ${dayOnly(w.end)}`;

  // Kopf mit Zeitleiste
  const now = Date.now();
  const steps: { d: Date; t: string; x: string }[] = [{ d: w.start, t: "Trainingsupdate", x: "neue Woche beginnt" }];
  const playedLeague = !league && [...state.week.played.values()].some((m) => m.sources.length);
  if (league) steps.push({ d: league.date, t: "Ligaspiel", x: "A-Kader, stärkste Elf" });
  else if (playedLeague) steps.push({ d: w.start, t: "Ligaspiel", x: "schon gespielt" });
  if (cup) steps.push({ d: cup.date, t: "Pokalspiel", x: "Sieg und Training abwägen" });
  else steps.push({ d: new Date(Math.min(w.end.getTime() - 864e5, Math.max(now, (league?.date.getTime() ?? now) + 2 * 864e5))), t: "Freundschaftsspiel", x: "nur Training, B-Kader" });
  steps.push({ d: w.end, t: "Trainingsupdate", x: "Minuten werden gezählt" });
  const timeline = steps
    .map((s, i) => {
      const cls = s.d.getTime() <= now || (i === 1 && playedLeague) ? "done" : steps.slice(0, i).every((p) => p.d.getTime() <= now) ? "now" : "";
      return `<div class="tw-tl ${cls}"><span class="dot"></span><div class="d">${s.t === "Freundschaftsspiel" ? "frei wählbar" : dayTime(s.d)}</div><div class="t">${esc(s.t)}</div><div class="x">${esc(s.x)}</div></div>`;
    })
    .join("");
  const meter = Array.from({ length: maxFull }, (_, i) => `<i class="${i < fullCount ? "f" : ""}"></i>`).join("");
  const hero = `<div class="tw-hero">
    <div>
      <div class="k">Eingestelltes Training</div>
      <div class="big">${esc(t.name)}</div>
      <div class="sub2">Voll: ${esc(list(t.full))}${t.partly.length ? ` · halb: ${esc(list(t.partly))}` : ""}<br>Nächstes Update ${countdown(w.end)}</div>
      <div class="tw-meter" title="voll trainierte Spieler diese Woche">${meter}</div>
      <div class="sub2"><b>${fullCount}</b> von höchstens ${maxFull} Spielern voll trainiert${halfCount ? `, ${halfCount} halb` : ""} (gespielt und geplant)</div>
    </div>
    <div class="tw-timeline">${timeline}</div>
  </div>`;

  // Ligaspiel
  let leagueCard = "";
  if (league) {
    const cur = formationCode(state.manual);
    const shown = lc ? lc.options.filter((o) => o === lc.best || o === lc.pick || o.hatStats >= lc.best.hatStats * 0.97).slice(0, 4) : [];
    const cards = shown
      .map(
        (o) => `<button type="button" class="tw-fc${o === lc!.pick ? " reco" : ""}${o.formation === cur ? " on" : ""}" data-twform="${o.formation}">
        ${o === lc!.pick ? `<span class="tf-reco">Empfehlung</span>` : ""}<b>${formationLabel(o.formation)}</b>
        <span>${o.hatStats.toFixed(0)} HatStats${o === lc!.best ? " · stärkste" : ""}</span>
        <span class="tf-dots">${"<i></i>".repeat(o.full)}${'<i class="half"></i>'.repeat(o.partly)}</span>
        <span class="muted">${slotText(o)} · Erf. ${o.experience}</span></button>`,
      )
      .join("");
    const lineupChips = state.manual
      .slice()
      .sort((a, b) => a.role - b.role)
      .map((p) => {
        const pl = byId.get(p.playerId);
        const lvl = trainingFor(p.role, t);
        return `<span class="tw-pl${lvl === "voll" ? " tr" : lvl === "teilweise" ? " half" : ""}">${tierBadge(p.playerId)}${esc((pl?.name ?? "?").split(" ").slice(-1)[0])} <i>${positionShort(p.role)}</i></span>`;
      })
      .join("");
    const differs = lc && cur !== lc.pick.formation;
    leagueCard = `<div class="card tw-card"><header><h3>1. Ligaspiel · ${dayTime(league.date)}</h3><span class="tw-goal">Ziel: Sieg, dann Training</span></header>
      ${lc ? `<div class="tw-forms">${cards}</div><p class="sub">${esc(lc.reason)}</p>` : `<p class="sub">Formationen werden gerechnet …</p>`}
      <div class="tw-sub">Deine Aufstellung (Aufstellungsseite) · ${formationLabel(cur)}</div>
      <div class="tw-lineup">${lineupChips}</div>
      ${differs ? `<p><button class="btn primary" data-twapply="${lc!.pick.formation}">${formationLabel(lc!.pick.formation)} in die Aufstellung übernehmen</button></p>` : ""}
    </div>`;
  } else {
    leagueCard = `<div class="card tw-card"><header><h3>1. Ligaspiel</h3><span class="tw-goal">Ziel: Sieg, dann Training</span></header>
      <p class="sub">${playedLeague ? "Das Ligaspiel dieser Trainingswoche ist schon gespielt. Wer dabei trainiert hat, steht unten als „gespielt“." : "In dieser Trainingswoche steht kein Ligaspiel mehr an."}</p></div>`;
  }

  // Zweites Spiel
  let secondCard = "";
  const chips = (positions: FieldPosition[]) =>
    positions
      .slice()
      .sort((a, b) => a.role - b.role)
      .map((p) => {
        const lvl = trainingFor(p.role, t);
        return `<span class="tw-pl${lvl === "voll" ? " tr" : lvl === "teilweise" ? " half" : ""}">${tierBadge(p.playerId)}${esc((byId.get(p.playerId)?.name ?? "?").split(" ").slice(-1)[0])} <i>${positionShort(p.role)}</i></span>`;
      })
      .join("");
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
  if (cup) {
    const C = state.cup;
    const opp = cup.homeId === hrf.team.teamId ? cup.awayName : cup.homeName;
    const head = `<header><h3>2. Spiel: Pokal · ${dayTime(cup.date)}</h3><span class="tw-goal b">Sieg + möglichst viel Training</span></header>`;
    if (!C) secondCard = `<div class="card tw-card">${head}<p class="sub">Pokalvarianten gegen ${esc(opp)} werden gerechnet …</p></div>`;
    else {
      const v = C.plan.variants.find((x) => x.key === state.cupPick) ?? C.plan.variants[0];
      const table = `<table class="tw-cmp"><thead><tr><th>Variante</th><th>Formation</th><th>${C.known ? "Siegchance" : "HatStats"}</th><th>neu trainiert</th></tr></thead><tbody>${C.plan.variants
        .map(
          (x) => `<tr class="${x.key === C.plan.recommended ? "rec" : ""}${x.key === v.key ? " on" : ""}" data-twcup="${x.key}"><td>${esc(x.label)}${x.key === C.plan.recommended ? ` <span class="tf-reco">Empfehlung</span>` : ""}</td><td>${formationLabel(x.formation)}</td><td>${C.known ? pct(x.win) : x.hatStats.toFixed(0)}</td><td>${x.newTrainees}</td></tr>`,
        )
        .join("")}</tbody></table>`;
      secondCard = `<div class="card tw-card">${head}
        <p class="sub">Gegner ${esc(C.opponent)}${C.known ? "" : " · keine Bewertungen bekannt, verglichen wird die eigene Stärke"}. Zeile antippen, um eine Variante zu wählen.</p>
        ${table}<p class="sub">${esc(C.plan.reason)}</p>
        <div class="tw-sub">${esc(v.label)} · ${formationLabel(v.formation)}</div><div class="tw-lineup">${chips(v.positions)}</div></div>`;
    }
  } else if (state.friendly) {
    const F = state.friendly;
    secondCard = `<div class="card tw-card"><header><h3>2. Spiel: Freundschaftsspiel</h3><span class="tw-goal b">Nur Training</span></header>
      <p class="sub">Der Sieg ist egal. Die ${maxTrainingSlots(t).full} Trainingsplätze bekommen die Spieler mit dem größten Trainingsnutzen (jung, „${esc(t.name)}“ hoch im Profil, Fertigkeit noch niedrig), die diese Woche noch nicht voll trainiert sind. Freundschaftsspiele gehen nur ohne Pokalspiel in der Woche.</p>
      <div class="tw-sub">Vorschlag · ${formationLabel(F.lineup.formation)} · ${F.trainedInFriendly.length} Trainingsplätze</div>
      <div class="tw-lineup">${chips(F.lineup.positions)}</div></div>`;
  }

  // Kader-Tabellen
  const suggested = suggestedTiers();
  const status = (r: WeekRow) => {
    const p = r.player;
    if (p.injury > 0) return statusChip("critical", `verletzt ${p.injury} W.`, "+");
    if (r.factor >= 1) return statusChip("good", "voll", "✓");
    if (r.factor > 0) return statusChip("warning", `${Math.round(r.factor * 100)} %`, "½");
    if (p.injury === 0 && !bruisedOk()) return statusChip("warning", "angeschlagen", "!");
    const kt = p.keeper >= Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing);
    if (kt && t.skill !== "keeper") return `<span class="muted">Torwart</span>`;
    return r.benefit >= 3 ? `<span class="tw-open">offen</span>` : `<span class="muted">kein</span>`;
  };
  const slot = (role: number, src: string[] = []) => {
    if (!role) return src.length ? `<span class="tw-slot played" title="${esc(src.join(", "))}">gespielt</span>` : `<span class="muted">–</span>`;
    const lvl = trainingFor(role, t);
    return `<span class="tw-slot${lvl === "voll" ? " v" : lvl === "teilweise" ? " h" : ""}">${positionShort(role)}</span>`;
  };
  const maxB = Math.max(1, ...rows.map((r) => r.benefit));
  const table = (tier: SquadTier) => {
    const rs = rows.filter((r) => r.tier === tier);
    if (!rs.length) return `<p class="sub">Keine Spieler.</p>`;
    return `<div class="scroll"><table class="tw-sq"><thead><tr><th>Spieler</th><th>Alter</th><th title="${esc(t.name)}: aktueller Wert der trainierten Fertigkeit">Wert</th><th>Nutzen</th><th>Liga</th><th>2. Spiel</th><th>Woche</th><th>Kader</th></tr></thead><tbody>${rs
      .map((r) => {
        const p = r.player;
        const own = state.squadOwn[p.id];
        const seg = (["A", "B", "R"] as SquadTier[])
          .map((x) => `<button type="button" class="kd-btn kd-${x}${r.tier === x ? " on" : ""}" data-twtier="${p.id}:${x}" title="${TIER_NAME[x]}${suggested.get(p.id) === x ? " (Vorschlag)" : ""}">${x === "R" ? "–" : x}</button>`)
          .join("");
        return `<tr><td>${tierBadge(p.id)}<button type="button" class="linkbtn pname-link" data-detail="${p.id}">${esc(p.name)}</button>${own && own !== suggested.get(p.id) ? ` <span class="muted" title="von dir zugeordnet">✎</span>` : ""}</td><td>${p.age}</td><td>${p[t.skill]}</td>
          <td><span class="tw-nb" style="width:${Math.max(3, Math.round((56 * r.benefit) / maxB))}px" title="Trainingsnutzen ${r.benefit.toFixed(1)}"></span></td>
          <td>${slot(r.leagueRole, r.playedSources)}</td><td>${slot(r.secondRole)}</td><td>${status(r)}</td><td class="kd-seg">${seg}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
  };
  const count = (x: SquadTier) => rows.filter((r) => r.tier === x).length;
  const forgot = forgotten(rows, t).filter((r) => r.player.injury < 0);
  const ownCount = Object.keys(state.squadOwn).length;
  const squads = `<div class="tw-squads">
    <div class="card tw-card"><header><h3><span class="kd kd-A">A</span> A-Kader <span class="muted">Stammelf, ${count("A")}</span></h3></header>${table("A")}</div>
    <div class="card tw-card"><header><h3><span class="kd kd-B">B</span> B-Kader <span class="muted">Trainingsgruppe, ${count("B")}</span></h3></header>${table("B")}</div>
  </div>
  <div class="card tw-card"><header><h3><span class="kd kd-R">–</span> Rest <span class="muted">${count("R")}</span></h3>
    <span class="sub">Vorschlag: A = Ligaelf, B = ein Torwart + die 10 mit dem größten Trainingsnutzen. ${ownCount ? `${ownCount} von dir geändert · <button type="button" class="linkbtn" id="twResetTiers">Vorschlag wiederherstellen</button>` : "Mit A / B / – änderst du die Zuordnung, sie bleibt gespeichert."}</span></header>${table("R")}</div>`;
  const alert = forgot.length
    ? `<div class="tw-alert"><b>Nicht vergessen:</b> ${forgot
        .slice(0, 6)
        .map((r) => `${esc(r.player.name)} (${r.player.age})`)
        .join(", ")} ${forgot.length === 1 ? "hat" : "haben"} spürbaren Trainingsnutzen und ${forgot.length === 1 ? "bekommt" : "bekommen"} diese Woche kein Training. Nächste Woche zuerst einplanen${fullCount >= maxFull ? " (diese Woche sind alle Plätze belegt)" : " oder im zweiten Spiel auf eine Trainingsposition stellen"}.</div>`
    : `<div class="tw-alert ok">Niemand mit spürbarem Trainingsnutzen geht diese Woche leer aus.</div>`;
  const rules = `<details class="more"><summary>So zählt „${esc(t.name)}“</summary><p class="sub">Voll: ${esc(list(t.full))}.${t.partly.length ? ` Halb: ${esc(list(t.partly))}.` : ""} Die Minuten aller Spiele einer Woche werden addiert, höchstens 90 zählen, Minuten auf voller Position zuerst. Wer im Ligaspiel schon 90 Minuten voll trainiert hat, gewinnt im zweiten Spiel nichts mehr dazu. „gespielt“ kommt aus dem HO-Download (letztes Spiel je Spieler).</p></details>`;

  out.innerHTML = `${hero}<div class="tw-games">${leagueCard}${secondCard}</div>${alert}${squads}${rules}`;
  const dl = $<HTMLButtonElement>("#dlFriendly");
  dl.textContent = second?.kind === "pokal" ? "Pokal-Aufstellung für HO speichern" : "Freundschaftsspiel für HO speichern";
  $("#friendlyIdLabel").firstChild!.textContent = second?.kind === "pokal" ? "Spiel-ID Pokalspiel" : "Spiel-ID Freundschaftsspiel";
  if (second?.kind === "pokal" && cup) $<HTMLInputElement>("#friendlyMatchId").value ||= String(cup.id);
}

function initTrainingWeek() {
  state.squadOwn = loadOwnSquads();
  $("#training").addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const tierBtn = el.closest<HTMLElement>("[data-twtier]");
    if (tierBtn) {
      const [id, tier] = tierBtn.dataset.twtier!.split(":");
      const sugg = suggestedTiers().get(Number(id));
      if (sugg === tier) delete state.squadOwn[Number(id)];
      else state.squadOwn[Number(id)] = tier as SquadTier;
      saveOwnSquads();
      renderTrainingWeek();
      renderLineup();
      return;
    }
    if (el.closest("#twResetTiers")) {
      state.squadOwn = {};
      saveOwnSquads();
      renderTrainingWeek();
      renderLineup();
      return;
    }
    const cupRow = el.closest<HTMLElement>("[data-twcup]");
    if (cupRow) {
      state.cupPick = cupRow.dataset.twcup as CupVariant["key"];
      renderTrainingWeek();
      return;
    }
    const f = el.closest<HTMLElement>("[data-twapply], [data-twform]");
    if (f) {
      const code = f.dataset.twapply ?? f.dataset.twform!;
      state.trainingMode = false;
      state.formation = code;
      state.manual = formationPositions();
      state.manualEdited = true;
      state.pick = null;
      state.choices = {};
      editorChanged();
      renderTrainingWeek();
      toast(`Ligaaufstellung: beste Elf in ${formationLabel(code)}.`);
    }
  });
}

// --- Spielerkarte (Details zu einem Spieler, Seitenleiste) -------------------------------------------

let cardPlayer = 0;
/** Fähigkeitsname wie auf Hattrick (5 durchschnittlich, 6 passabel …) */
const skillName = (v: number) => LEVEL_DE[Math.max(0, Math.min(LEVEL_DE.length - 1, Math.floor(v)))];
const deNum = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

function openPlayerCard(id: number) {
  if (!state.hrf?.players.some((p) => p.id === id)) return;
  cardPlayer = id;
  renderPlayerCard();
  $("#playerCard").hidden = false;
  $("#cardScrim").hidden = false;
  requestAnimationFrame(() => $("#playerCard").classList.add("open"));
  $<HTMLButtonElement>("#playerCard .pc-close")?.focus();
}

function closePlayerCard() {
  cardPlayer = 0;
  $("#playerCard").classList.remove("open");
  $("#playerCard").hidden = true;
  $("#cardScrim").hidden = true;
}

function renderPlayerCard() {
  const hrf = state.hrf;
  const p = hrf?.players.find((x) => x.id === cardPlayer);
  if (!hrf || !p) return;
  tierCache = null;
  const t = TRAININGS[hrf.team.trainingType];
  const tier = tierOf(p.id) ?? "R";
  const suggested = suggestedTiers().get(p.id);
  const onField = state.manual.find((x) => x.playerId === p.id);
  const bench = Object.entries(myLineup().bench).find(([, id]) => id === p.id)?.[0] as BenchSlot | undefined;
  const wk = state.week?.played.get(p.id);
  const wf = weekFactor(wk);

  const chips = [
    `Form ${p.form}`,
    `Kondition ${p.stamina}`,
    `Erfahrung ${p.experience}`,
    `Führung ${p.leadership}`,
    ...(p.specialtyLabel ? [`Spezialität: ${p.specialtyLabel}`] : []),
  ].map((x) => `<span class="pc-chip">${esc(x)}</span>`);
  if (p.injury > 0) chips.push(`<span class="pc-chip bad">verletzt, ${p.injury} ${p.injury === 1 ? "Woche" : "Wochen"}</span>`);
  else if (p.injury === 0) chips.push(`<span class="pc-chip warn">angeschlagen</span>`);
  if (p.cards >= 3) chips.push(`<span class="pc-chip bad">gesperrt</span>`);
  else if (p.cards > 0) chips.push(`<span class="pc-chip warn">${p.cards} ${p.cards === 1 ? "Gelbe Karte" : "Gelbe Karten"}</span>`);
  if (t && wf >= 1) chips.push(`<span class="pc-chip good" title="${esc(wk!.sources.join(", "))}">✓ diese Woche ${esc(t.name)}</span>`);
  else if (t && wf > 0) chips.push(`<span class="pc-chip warn" title="${esc(wk!.sources.join(", "))}">½ diese Woche ${esc(t.name)}</span>`);

  const seg = (["A", "B", "R"] as SquadTier[])
    .map((x) => `<button type="button" class="kd-btn kd-${x}${tier === x ? " on" : ""}" data-pctier="${x}" title="${TIER_NAME[x]}">${x === "R" ? "–" : x}</button>`)
    .join("");

  const hist = state.ho?.history.get(p.id);
  const start = startSkills(p);
  const skills: DevSkill[] = ["keeper", "defending", "playmaking", "winger", "passing", "scoring", "setPieces"];
  const trainedSkill = t?.skill;
  const skillRows = [...skills]
    .sort((a, b) => (a === trainedSkill ? -1 : b === trainedSkill ? 1 : start[b] - start[a]))
    .map((s) => {
      const v = start[s];
      const tr = s === trainedSkill;
      return `<div class="pc-sk${tr ? " tr" : ""}"><span>${tr ? "<b>" : ""}${DEV_SKILL_DE[s]}${tr ? "</b>" : ""}</span><span class="pc-bar"><i style="width:${Math.min(100, (v / 20) * 100).toFixed(1)}%"></i></span><span class="v" title="${hist ? "mit Unterstufe aus der HO-Historie" : ""}">${deNum(v, Number.isInteger(v) ? 0 : 1)} ${skillName(v)}</span></div>`;
    })
    .join("");

  const groups = GROUPS.map((g) => ({ g, v: groupValue(p, g) })).sort((a, b) => b.v - a.v).slice(0, 3);
  const curSector = onField ? lineupSector(onField.role) : undefined;
  const posCards = groups
    .map((x, i) => `<div class="pc-pos${i === 0 ? " best" : ""}"><span>${GROUP_DE[x.g]}</span><b>${deNum(x.v, 2)}</b><span class="muted">${curSector === x.g ? "spielt hier" : i === 0 ? "beste Position" : ""}</span></div>`)
    .join("");

  // Training und Entwicklung
  let trainHtml = "";
  if (t) {
    const benefit = trainingPriority(p, t);
    const lvl = benefit >= 6 ? "hoch" : benefit >= 3 ? "mittel" : "gering";
    const o = state.outlooks.get(p.id);
    const proj = state.projection?.(p) ?? [];
    const sk = (trainedSkill === "setPieces" ? "setPieces" : trainedSkill) as DevSkill;
    const vals = proj.map((x) => x.values[sk]);
    let chart = "";
    if (vals.length > 1) {
      const lo = Math.floor(Math.min(...vals)), hi = Math.ceil(Math.max(...vals) + 0.01);
      const W = 360, H = 90;
      const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - 8 - ((v - lo) / Math.max(0.5, hi - lo)) * (H - 20)).toFixed(1)}`).join(" ");
      const next = vals.findIndex((v) => Math.floor(v) > Math.floor(vals[0]));
      chart = `<svg class="pc-chart" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Prognose ${esc(DEV_SKILL_DE[sk])}">
        <polyline points="${pts}" fill="none" stroke="var(--good)" stroke-width="2.5"/>
        <text x="0" y="${H + 12}" font-size="11" fill="var(--muted)">jetzt ${deNum(vals[0])}</text>
        <text x="${W}" y="${H + 12}" font-size="11" fill="var(--muted)" text-anchor="end">in ${proj.length - 1} Wochen ${deNum(vals[vals.length - 1])}</text></svg>
        <p class="sub">${next > 0 ? `${esc(DEV_SKILL_DE[sk])} ${Math.floor(vals[0]) + 1} in etwa ${next} ${next === 1 ? "Woche" : "Wochen"}` : `In ${proj.length - 1} Wochen keine ganze Stufe mehr in ${esc(DEV_SKILL_DE[sk])}`}, mit dem Training, das er diese Woche bekommt.</p>`;
    }
    trainHtml = `<div class="pc-train">Trainingsnutzen für „${esc(t.name)}“: <b>${lvl}</b> (${deNum(benefit)} von 10).${o ? ` ${esc(o.text)}` : ""}</div>${chart}`;
  }

  const last =
    p.lastMatchDate && (p.lastMatchMinutes ?? 0) > 0
      ? `${new Date(p.lastMatchDate.replace(" ", "T")).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${esc(positionShort(p.lastMatchPosition) || "–")} · ${p.lastMatchMinutes} Minuten${p.lastMatchRating ? ` · ${deNum(p.lastMatchRating)} Sterne` : ""}`
      : "kein Spiel bekannt";

  const actions = [
    `<button class="btn primary" data-pcdev>Ganze Entwicklung</button>`,
    onField ? `<button class="btn" data-pcremove="${onField.role}">Vom Feld nehmen</button>` : "",
  ].join("");

  $("#playerCard").innerHTML = `<div class="pc-head">
      <div class="token tk-${tier} fit-good">${esc(initials(p.name))}</div>
      <div><h2>${esc(p.name)}</h2><div class="sub">${p.age} Jahre, ${p.ageDays} Tage${p.homegrown ? " · Eigengewächs" : ""} · TSI ${p.tsi.toLocaleString("de-DE")} · Gehalt ${p.salary.toLocaleString("de-DE")}</div>
      <div class="sub">${onField ? `auf dem Feld: ${ROLE_DE[onField.role]}` : bench ? `auf der Bank: ${BENCH_DE[bench]}` : "nicht aufgestellt"}</div></div>
      <button class="pc-close" aria-label="Schließen">×</button></div>
    <div class="pc-chips">${chips.join("")}</div>
    <div class="pc-kader"><span class="sub">Kader</span><span class="kd-seg">${seg}</span><span class="sub">Vorschlag: ${TIER_NAME[suggested ?? "R"]}</span></div>
    <h3>Fertigkeiten</h3>${skillRows}
    <h3>Beste Positionen</h3><div class="pc-poss">${posCards}</div>
    ${trainHtml ? `<h3>Training und Entwicklung</h3>${trainHtml}` : ""}
    <h3>Letztes Spiel</h3><p class="sub">${last}</p>
    <div class="pc-actions">${actions}</div>`;
}

function initPlayerCard() {
  // Capture: vor den Klick-Handlern des Editors, damit ein Detail-Knopf keinen Spieler auswählt
  document.addEventListener(
    "click",
    (e) => {
      const d = (e.target as HTMLElement).closest<HTMLElement>("[data-detail]");
      if (!d) return;
      e.stopPropagation();
      e.preventDefault();
      openPlayerCard(Number(d.dataset.detail));
    },
    true,
  );
  document.addEventListener("dblclick", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("#aufstellung [data-pid], #kader [data-pid]");
    if (el) openPlayerCard(Number(el.dataset.pid));
  });
  $("#cardScrim").addEventListener("click", closePlayerCard);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && cardPlayer) closePlayerCard();
  });
  $("#playerCard").addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest(".pc-close")) return closePlayerCard();
    const tb = el.closest<HTMLElement>("[data-pctier]");
    if (tb) {
      const tier = tb.dataset.pctier as SquadTier;
      if (suggestedTiers().get(cardPlayer) === tier) delete state.squadOwn[cardPlayer];
      else state.squadOwn[cardPlayer] = tier;
      saveOwnSquads();
      renderPlayerCard();
      renderLineup();
      renderTrainingWeek();
      return;
    }
    if (el.closest("[data-pcdev]")) {
      state.devPlayer = cardPlayer;
      closePlayerCard();
      renderDevelopment();
      location.hash = "#entwicklung";
      return;
    }
    const rm = el.closest<HTMLElement>("[data-pcremove]");
    if (rm) {
      removeRole(Number(rm.dataset.pcremove));
      renderPlayerCard();
    }
  });
}

function renderAdvice() {
  const A = state.advice;
  if (!A) return;
  const hrf = state.hrf!;
  const cash = hrf.team.expectedCash ?? hrf.team.cash;
  const B = budget(hrf.players, cash);
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
        B.cash > 0
          ? hrf.team.expectedCash !== null
            ? `Budget = erwarteter Kontostand zum Wochenende ${euro(B.cash)} (Kontostand ${euro(hrf.team.cash)}${hrf.team.costsBoughtPlayers > 0 ? `, Käufe dieser Woche ${euro(hrf.team.costsBoughtPlayers)}` : ""}) minus fünf Wochen Gehälter (${euro(B.reserve)}).`
            : `Budget = Kontostand ${euro(B.cash)} minus fünf Wochen Gehälter (${euro(B.reserve)}).`
          : "Kontostand ist in der Datei nicht enthalten, deshalb ohne Budget."
      }</p>`
    : `<p class="focus ok">Kein dringender Transferbedarf: keine deutliche Schwachstelle und keine Lücke in der Kaderplanung.</p>`;
  $("#adviceOut").innerHTML = `
    <h3>Suchprofile für den Transfermarkt</h3>
    ${profiles}
    ${A.summary.map((s) => `<p class="focus ok">${esc(s)}</p>`).join("")}
    <h3>Wo eine Verstärkung am meisten bringt</h3>
    <div class="scroll"><table class="nowrap"><thead><tr><th>Position</th><th>Fertigkeit</th><th>Spielt jetzt</th><th class="num">+1 Stufe</th><th class="num">+2 Stufen</th><th>Hilft bei Schwachstelle</th></tr></thead><tbody>
    ${A.upgrades.map((u) => `<tr><td>${u.position}</td><td>${u.skill}</td><td>${esc(u.currentPlayer)}</td><td class="num">+${u.gainPlus1.toFixed(1)}</td><td class="num">+${u.gainPlus2.toFixed(1)}</td><td>${u.helps.length ? esc(u.helps.join(", ")) : '<span class="muted">nein</span>'}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="sub">Zuwachs an HatStats, wenn auf dieser Position ein sonst gleicher Spieler mit höherer Fertigkeit stünde. Sortiert nach dem Zuwachs in den Schwachstellen (gleiche Grundlage wie die Seite Schwachstellen). Ein Torwart oder Innenverteidiger hebt alle drei Abwehrteile gleichzeitig und hat deshalb oft viele HatStats, hilft aber nur, wenn die Abwehr eine Schwachstelle ist. Gekaufte Spieler haben anfangs keine Treue, sie brauchen deshalb etwa eine Stufe mehr.</p>
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
        <td><button type="button" class="linkbtn pname-link" data-detail="${p.id}">${esc(p.name)}</button></td><td class="num">${p.age}</td>
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

const VIEWS = ["spieltag", "aufstellung", "gegner", "kader", "schwachstellen", "entwicklung", "kaderplanung", "transfers", "training", "trainer", "spielplan", "finanzen", "verlauf"];
const VIEW_ALIAS: Record<string, string> = { spiel: "spieltag", "": "spieltag", trainingswoche: "training", freundschaftsspiel: "training", historie: "verlauf", anweisungen: "aufstellung", elfmeter: "aufstellung", auswechslungen: "aufstellung" };
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
    // eigene Aufstellung kann sich geändert haben
    if (v === "schwachstellen" || v === "transfers" || v === "spieltag" || v === "kaderplanung") {
      updateAnalysis();
      renderWeakness();
      renderAdvice();
      renderTiles();
      renderPlan();
    }
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
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-goto]");
    if (b) document.getElementById(b.dataset.goto!)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#groupsOut").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-gmode]");
    if (!b) return;
    groupMode = b.dataset.gmode as typeof groupMode;
    renderGroups();
  });
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

let groupMode: "balanced" | "best" | "lineup" = "balanced";

/**
 * Kader nach Mannschaftsteilen, jeder Spieler genau einmal: in seiner besten Gruppe oder (Option) dort,
 * wo er in deiner Aufstellung spielt. Weitere gut passende Gruppen stehen als „auch“-Hinweis dabei.
 */
function renderGroups() {
  const players = state.hrf!.players;
  const inLineup = new Map(state.manual.map((p) => [p.playerId, lineupSector(p.role)]));
  const fit = fitTable(players);
  const groupMax = new Map(GROUPS.map((g) => [g, Math.max(1e-6, ...players.map((p) => groupValue(p, g)))]));
  const field = state.manual.length ? state.manual : (state.league?.lineup.positions ?? []);
  const needed = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<LineupSector, number>;
  for (const pos of field) needed[lineupSector(pos.role)]++;
  const balanced = balancedHome(players, new Map(field.map((pos) => [pos.playerId, lineupSector(pos.role)])));
  const home = (p: Player) =>
    groupMode === "lineup" && inLineup.has(p.id) ? inLineup.get(p.id)! : groupMode === "balanced" ? balanced.get(p.id)! : fit.home(p);
  const rows = players.map((p) => {
    const g = home(p);
    const av = availability(p);
    const st = staminaShare(p.stamina);
    const value = groupValue(p, g);
    const best = fit.home(p);
    const alts = GROUPS.filter((x) => x !== g && fit.rel(p, x) >= 0.7 && fit.rel(p, x) >= 0.85 * fit.rel(p, best))
      .sort((a, b) => fit.rel(p, b) - fit.rel(p, a))
      .slice(0, 3);
    return { p, g, value, score: value * st * av.factor, share: (value * st * av.factor) / groupMax.get(g)!, stamina: st, av, alts, plays: inLineup.has(p.id), offPos: groupMode !== "best" && inLineup.has(p.id) && fit.rel(p, g) < 0.8 * fit.rel(p, best) };
  });
  // bester Aushilfskandidat aus einer anderen Gruppe, gemessen an den Stammspielern dieser Gruppe
  const stand = (g: LineupSector) => {
    const st = rows.filter((r) => r.g === g && r.plays).map((r) => groupValue(r.p, g));
    if (!st.length) return "";
    const avg = st.reduce((a, v) => a + v, 0) / st.length;
    const c = rows
      .filter((r) => r.g !== g && !r.plays && r.av.factor > 0)
      .map((r) => ({ r, v: groupValue(r.p, g) }))
      .sort((a, b) => b.v - a.v)[0];
    return c ? ` Bester Aushelfer: ${esc(c.r.p.name)} (${GROUP_SHORT[c.r.g]}), ${Math.round((c.v / avg) * 100)} % der Stammspieler hier.` : "";
  };
  const member = (m: (typeof rows)[number]) => {
    const p = m.p;
    const off = m.av.factor === 0;
    const status = m.av.status === "fit" ? "" : statusChip(off ? "critical" : "warning", m.av.label, off ? "+" : "!");
    const alts = m.alts.length ? `<span class="alts">auch ${m.alts.map((x) => `<i title="${esc(GROUP_DE[x])}: ${Math.round(fit.rel(p, x) * 100)} % des Kaderbesten">${GROUP_SHORT[x]}</i>`).join("")}</span>` : "";
    return `<div class="member${off ? " out" : ""}" title="Positionsstärke ${m.value.toFixed(2)} · Kondition hält ${Math.round(m.stamina * 100)} % · ${esc(m.av.label)}">
      <div class="nm"><button type="button" class="linkbtn pname-link n" data-detail="${p.id}">${esc(p.name)}</button> <small>${p.age} J.</small>${m.plays ? `<span class="inxi">${inLineup.get(p.id) === m.g ? "spielt" : `spielt ${GROUP_SHORT[inLineup.get(p.id)!]}`}</span>` : ""}${m.offPos ? `<span class="inxi warn" title="Beste Position: ${esc(GROUP_DE[fit.home(p)])}">nicht beste Pos.</span>` : ""}</div>
      <div class="fit" aria-label="Einsatzwert ${Math.round(m.share * 100)} %"><i style="width:${Math.min(100, m.share * 100).toFixed(0)}%"></i></div>
      <div class="attrs">${GROUP_SKILLS[m.g].map((k) => `<span>${SKILL_SHORT[k]} <b>${p[k]}</b></span>`).join("")}<span>Form <b>${p.form}</b></span><span>Kond. <b>${p.stamina}</b></span>${p.cards ? `<span>Gelb <b>${p.cards}</b></span>` : ""}${status}${alts}</div>
    </div>`;
  };
  const fm = formationLabel(formationCode(state.manual.length ? state.manual : (state.league?.lineup.positions ?? [])));
  const intro =
    groupMode === "balanced"
      ? `Jeder Spieler steht einmal. Ausgewogen: deine Stammelf (${fm}) steht, wo sie spielt; dazu bekommt jede Gruppe je Platz einen Ersatz, gemessen daran, wie nah er an die Stammspieler dort herankommt. Übrige Spieler stehen in ihrer stärksten Gruppe.`
      : groupMode === "best"
        ? "Jeder Spieler steht einmal, in der Gruppe, in der er dem Kaderbesten am nächsten kommt. Ein Ausreißer (z. B. ein Verteidiger mit Flügelspiel 10) kann dabei alle anderen aus einer Gruppe drängen."
        : "Jeder Spieler steht einmal: wer in deiner Aufstellung spielt, dort, wo er spielt; alle anderen in ihrer besten Gruppe.";
  $("#groupsOut").innerHTML = `<div class="controls"><div class="seg" role="tablist" aria-label="Zuordnung"><button data-gmode="balanced" class="${groupMode === "balanced" ? "on" : ""}">Ausgewogen</button><button data-gmode="best" class="${groupMode === "best" ? "on" : ""}">Beste Position</button><button data-gmode="lineup" class="${groupMode === "lineup" ? "on" : ""}">Wie aufgestellt</button></div></div>
    <p class="sub">${intro} Balken = Positionsstärke × Kondition × Verfügbarkeit, relativ zum Kaderbesten in dieser Gruppe. „auch“ = Gruppen, in denen er fast genauso gut ist. Verletzte und Gesperrte stehen durchgestrichen am Ende.</p>
    <div class="groups">${GROUPS.map((g) => {
      const ms = rows.filter((r) => r.g === g).sort((a, b) => (groupMode === "lineup" ? Number(b.plays) - Number(a.plays) : 0) || b.score - a.score || b.value - a.value);
      const ready = ms.filter((m) => m.av.factor > 0).length;
      const playing = ms.filter((m) => m.plays).length;
      const need = needed[g];
      const thin = need > 0 && ready < need * 2;
      return `<div class="group${thin ? " thin" : ""}"><h3>${esc(GROUP_DE[g])}<span class="sub">${ready} einsatzbereit${need ? ` · ${need} ${need === 1 ? "Platz" : "Plätze"}` : ""}${playing ? ` · ${playing} spielen` : ""}</span></h3>
        ${thin ? `<div class="thin-note">Dünn besetzt: ${ready} einsatzbereit für ${need} ${need === 1 ? "Platz" : "Plätze"} (Ziel: ${need * 2} mit Ersatz).${stand(g)}</div>` : ""}
        <div class="keys">Wichtig: ${GROUP_SKILLS[g].map((k) => DEV_SKILL_DE[k]).join(", ")}</div>
        ${ms.map(member).join("") || '<p class="sub">Niemand mit dieser Stärke im Kader.</p>'}
      </div>`;
    }).join("")}</div>`;
}

// --- HRF für HO speichern --------------------------------------------------------------

function download(lineup: Lineup, kind: "liga" | "freundschaft" | "pokal") {
  if (!state.hrf) return;
  const idInput = $<HTMLInputElement>(kind === "liga" ? "#matchId" : "#friendlyMatchId");
  const matchId = Number(idInput.value);
  if (!matchId) {
    $("#error").textContent = "Bitte zuerst die Spiel-ID eintragen (steht in HO bei „Spiel auswählen“ bzw. auf hattrick.org in der Spieladresse).";
    idInput.focus();
    return;
  }
  // HO-Spieltypen: 1 = Liga, 3 = Pokal, 4 = Freundschaftsspiel
  const matchType = kind === "liga" ? Number($<HTMLSelectElement>("#matchType").value) : kind === "pokal" ? 3 : 4;
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
  initTheme();
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
    const byId = playersById();
    const lineup = myLineup();
    const problems = [...lineupProblems(state.manual, byId), ...ordersBlocking(lineup, byId, state.hrf.team.tacticalAssistants)];
    $("#error").textContent = "";
    if (problems.length) {
      $("#error").textContent = problems.join(" ");
      $("#error").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    download(withOrders(lineup, byId), "liga");
    if ($("#error").textContent) $("#error").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  initEditor();
  initEditorHint();
  initWeakness();
  initNav();
  initTrainingWeek();
  initPlayerCard();
  initTrainerPage($("#trainerOut"));
  initOrdersPage($("#ordersOut"), {
    lineup: () => myLineup(),
    byId: playersById,
    tacticalAssistants: () => state.hrf?.team.tacticalAssistants ?? 0,
    opponent: () => {
      const m = state.match;
      const hrf = state.hrf;
      if (!m || !hrf || !state.ho) return null;
      const home = m.homeId === hrf.team.teamId;
      return { name: home ? m.awayName : m.homeName, players: teamPlayers(state.ho, home ? m.awayId : m.homeId) };
    },
    subContext: () => ({
      training: state.hrf ? TRAININGS[state.hrf.team.trainingType] : undefined,
      week: state.week?.played,
      matchType: Number($<HTMLSelectElement>("#matchType").value) || 1,
    }),
    changed: () => {
      if (state.league) {
        $("#pitchOut").innerHTML = editPitch();
        drawFlow();
      }
      const info = document.querySelector("#ordersInfo");
      if (info && state.hrf) info.textContent = ordersSummary(myLineup(), playersById());
    },
  });
  initHistory(() => state.folder);
  $("#dlFriendly").addEventListener("click", () => {
    const x = secondLineup();
    if (x) download(x.lineup, x.kind);
  });
  // Countdown und Datenstand jede Minute auffrischen
  setInterval(() => state.hrf && (renderHero(), renderDataChip()), 60_000);
  initFolder();
}

/** Hell/Dunkel: ohne gespeicherte Wahl folgt die App dem System. */
function initTheme() {
  const KEY = "tophatt.theme";
  const root = document.documentElement;
  const sysDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const current = () => (root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : sysDark() ? "dark" : "light");
  const btn = $<HTMLButtonElement>("#themeBtn");
  const label = () => {
    const next = current() === "dark" ? "hellen" : "dunklen";
    btn.title = `Zum ${next} Modus wechseln`;
    btn.setAttribute("aria-label", btn.title);
  };
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* ohne Speicher nur für diese Sitzung */ }
    label();
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", label);
  label();
}

/** Bedienhinweis nur zeigen, bis das Feld einmal bearbeitet wurde. */
function initEditorHint() {
  const KEY = "tophatt.editorHintSeen";
  const hint = $("#editorHint");
  let seen = false;
  try { seen = localStorage.getItem(KEY) === "1"; } catch { /* ohne Speicher immer zeigen */ }
  hint.hidden = seen;
  if (seen) return;
  const done = () => {
    hint.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch { /* egal */ }
  };
  for (const id of ["#pitchOut", "#poolOut"]) {
    $(id).addEventListener("drop", done, { once: true });
    $(id).addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".slot,.bslot,.pl,[data-pid]")) done(); });
  }
}

/** Speichern ohne Scrollen: Knopf in der Kopfzeile, auf dem Handy als Leiste unten. */

init();
