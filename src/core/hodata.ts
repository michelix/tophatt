// Daten aus der HO-Datenbank, die TopHatt-Sync als tophatt-data.json exportiert:
// Spielplan, Tabelle, Spielerhistorie, Training.

import { type MatchRating, parseMatchRatings } from "./opponent";

export interface HoMatch {
  id: number;
  type: number; // 1 Liga, 2 Quali, 3 Pokal, 4/5/8/9 Freundschaft ...
  date: Date;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  finished: boolean;
  lineupSent: boolean;
  derby: boolean;
  neutral: boolean;
  weatherForecast: number;
}

export interface Fixture {
  leagueId: number;
  season: number;
  round: number;
  date: Date;
  homeId: number;
  homeName: string;
  awayId: number;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  matchId: number;
}

export interface Standing {
  teamId: number;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  position: number;
}

export interface SkillSnapshot {
  date: Date;
  age: number;
  ageDays: number;
  keeper: number;
  defending: number;
  playmaking: number;
  winger: number;
  passing: number;
  scoring: number;
  setPieces: number;
  form: number;
  stamina: number;
  tsi: number;
}

export interface TrainingWeek {
  date: Date;
  type: number;
  intensity: number;
  staminaShare: number;
  coachLevel: number;
  assistantsLevel: number;
  /** Herkunft laut HO: 1 = HRF-Download, 2 = von Hand geplant, 3 = von HO geschätzt */
  source: number;
}

export interface HoData {
  generated: Date;
  teamId: number;
  matches: HoMatch[];
  fixtures: Fixture[];
  currentLeague: { id: number; season: number; name: string } | null;
  /** Historie je Spieler-ID, nach Datum sortiert; Werte mit Unterstufen (z. B. 7.25) */
  history: Map<number, SkillSnapshot[]>;
  training: TrainingWeek[];
  futureTraining: TrainingWeek[];
  /** Bewertungen aus HO-Spielberichten, auch die der Gegner (Gegnercheck), neueste zuerst */
  matchRatings: MatchRating[];
}

type Row = Record<string, unknown>;
const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const b = (v: unknown) => v === true;
/** HO speichert Zeiten ohne Zeitzone in der lokalen Zeit des Nutzers */
export const parseHoDate = (v: unknown): Date => new Date(s(v).replace(" ", "T"));

export function parseHoData(json: string): HoData {
  const raw = JSON.parse(json) as Record<string, Row[] | unknown>;
  const rows = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as Row[]) : []);
  const basics = rows("basics")[0] ?? {};
  const teamId = n(basics.teamid);

  const matches: HoMatch[] = rows("matches").map((r) => ({
    id: n(r.matchid),
    type: n(r.matchtyp),
    date: parseHoDate(r.matchdate),
    homeId: n(r.heimid),
    homeName: s(r.heimname),
    awayId: n(r.gastid),
    awayName: s(r.gastname),
    homeGoals: n(r.heimtore, -1),
    awayGoals: n(r.gasttore, -1),
    finished: n(r.status) === 1,
    lineupSent: b(r.aufstellung),
    derby: b(r.isderby),
    neutral: b(r.isneutral),
    weatherForecast: n(r.weatherforecast, -1),
  }));

  const fixtures: Fixture[] = rows("fixtures").map((r) => ({
    leagueId: n(r.ligaid),
    season: n(r.saison),
    round: n(r.spieltag),
    date: parseHoDate(r.datum),
    homeId: n(r.heimid),
    homeName: s(r.heimname),
    awayId: n(r.gastid),
    awayName: s(r.gastname),
    homeGoals: n(r.heimtore, -1),
    awayGoals: n(r.gasttore, -1),
    matchId: n(r.matchid),
  }));

  const leagues = rows("leagues").map((r) => ({ id: n(r.ligaid), season: n(r.saison), name: s(r.liganame) }));
  const currentSeason = n(basics.saison) || Math.max(0, ...leagues.map((l) => l.season));
  const currentLeague = leagues.find((l) => l.season === currentSeason) ?? leagues.sort((a, z) => z.season - a.season)[0] ?? null;

  const history = new Map<number, SkillSnapshot[]>();
  for (const r of rows("players")) {
    const id = n(r.spielerid);
    const sub = (k: string) => Math.min(0.99, Math.max(0, n(r["sub" + k])));
    const snap: SkillSnapshot = {
      date: parseHoDate(r.datum),
      age: n(r.age),
      ageDays: n(r.agedays),
      keeper: n(r.torwart) + sub("torwart"),
      defending: n(r.verteidigung) + sub("verteidigung"),
      playmaking: n(r.spielaufbau) + sub("spielaufbau"),
      winger: n(r.fluegel) + sub("fluegel"),
      passing: n(r.passpiel) + sub("passpiel"),
      scoring: n(r.torschuss) + sub("torschuss"),
      setPieces: n(r.standards) + sub("standards"),
      form: n(r.form),
      stamina: n(r.kondition),
      tsi: n(r.marktwert),
    };
    const list = history.get(id) ?? [];
    list.push(snap);
    history.set(id, list);
  }
  for (const list of history.values()) list.sort((a, z) => a.date.getTime() - z.date.getTime());

  const training = (k: string): TrainingWeek[] =>
    rows(k)
      .map((r) => ({
        date: parseHoDate(r.training_date),
        type: n(r.training_type, -1),
        intensity: n(r.training_intensity),
        staminaShare: n(r.stamina_share),
        coachLevel: n(r.coach_level),
        assistantsLevel: n(r.training_assistants_level),
        source: n(r.source, 1),
      }))
      .sort((a, z) => a.date.getTime() - z.date.getTime());

  return {
    generated: parseHoDate(raw.generated),
    teamId,
    matches,
    fixtures,
    currentLeague,
    history,
    training: training("training"),
    futureTraining: training("futureTraining"),
    matchRatings: parseMatchRatings(rows("matchRatings")),
  };
}

export const isOwn = (m: { homeId: number; awayId: number }, teamId: number) => m.homeId === teamId || m.awayId === teamId;

/** Kommende eigene Spiele (Liga und Pokal zuerst relevant), nach Datum */
export function upcomingMatches(d: HoData, now = new Date()): HoMatch[] {
  return d.matches.filter((m) => isOwn(m, d.teamId) && !m.finished && m.date.getTime() > now.getTime() - 2 * 3600e3).sort((a, z) => a.date.getTime() - z.date.getTime());
}

export function recentMatches(d: HoData, count = 5): HoMatch[] {
  return d.matches
    .filter((m) => isOwn(m, d.teamId) && m.finished)
    .sort((a, z) => z.date.getTime() - a.date.getTime())
    .slice(0, count);
}

/** Tabelle aus den gespielten Paarungen der aktuellen Liga */
export function standings(d: HoData): Standing[] {
  if (!d.currentLeague) return [];
  const lg = d.currentLeague;
  const fx = d.fixtures.filter((f) => f.leagueId === lg.id && f.season === lg.season);
  const table = new Map<number, Standing>();
  const row = (id: number, name: string) => {
    let r = table.get(id);
    if (!r) table.set(id, (r = { teamId: id, name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, position: 0 }));
    return r;
  };
  for (const f of fx) {
    const h = row(f.homeId, f.homeName);
    const a = row(f.awayId, f.awayName);
    if (f.homeGoals < 0 || f.awayGoals < 0) continue;
    h.played++;
    a.played++;
    h.goalsFor += f.homeGoals;
    h.goalsAgainst += f.awayGoals;
    a.goalsFor += f.awayGoals;
    a.goalsAgainst += f.homeGoals;
    if (f.homeGoals > f.awayGoals) {
      h.won++;
      a.lost++;
      h.points += 3;
    } else if (f.homeGoals < f.awayGoals) {
      a.won++;
      h.lost++;
      a.points += 3;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  const list = [...table.values()].sort(
    (x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.name.localeCompare(y.name),
  );
  list.forEach((r, i) => (r.position = i + 1));
  return list;
}

/** Spieltag eines Spiels in der aktuellen Liga (0, wenn unbekannt) */
export function roundOf(d: HoData, matchId: number): number {
  return d.fixtures.find((f) => f.matchId === matchId)?.round ?? 0;
}

export const MATCH_TYPE_DE: Record<number, string> = {
  1: "Ligaspiel",
  2: "Relegation",
  3: "Pokalspiel",
  4: "Freundschaftsspiel",
  5: "Freundschaftsspiel",
  8: "Freundschaftsspiel",
  9: "Freundschaftsspiel",
};

export const WEATHER_DE: Record<number, string> = { 0: "Regen", 1: "bewölkt", 2: "heiter", 3: "Sonne" };
