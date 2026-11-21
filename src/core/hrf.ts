// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// HRF-Dateien (Hattrick Organizer Export) lesen und eine Aufstellung hineinschreiben.
// Format: INI-ähnlich, Abschnitte [basics], [team], [lineup], [playerNNN] ...
// Die Abschnittsnamen und Schlüssel stammen aus HOs HRFStringBuilder/HRFStringParser.

import type { BenchSlot, Hrf, Lineup, Player, TeamInfo } from "./model";
import { BENCH_BACKUP_KEYS, orderKeys, validBackups } from "./orders";
import { Role } from "./model";
export const FORM_SUB_DEFAULT = 0.5;

type Section = { name: string; props: Map<string, string> };

export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = { name: head[1].toLowerCase(), props: new Map() };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    current.props.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }
  return sections;
}

const num = (p: Map<string, string>, key: string, fallback = 0): number => {
  const v = p.get(key);
  if (v === undefined || v === "" || v === "null") return fallback;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};
const str = (p: Map<string, string>, key: string) => p.get(key) ?? "";
const bool = (p: Map<string, string>, key: string) => str(p, key).toLowerCase() === "true";

function parsePlayer(p: Map<string, string>, id: number, currencyRate: number): Player {
  const player: Player = {
    id,
    name: str(p, "name"),
    age: num(p, "ald"),
    ageDays: num(p, "agedays"),
    keeper: num(p, "mlv"),
    defending: num(p, "bac"),
    playmaking: num(p, "spe"),
    passing: num(p, "fra"),
    winger: num(p, "ytt"),
    scoring: num(p, "mal"),
    setPieces: num(p, "fas"),
    experience: num(p, "rut"),
    leadership: num(p, "led"),
    form: num(p, "for"),
    formSub: 0,
    stamina: num(p, "uth"),
    loyalty: num(p, "loy"),
    homegrown: bool(p, "homegr"),
    specialty: num(p, "speciality"),
    specialtyLabel: str(p, "specialitylabel"),
    injury: num(p, "ska", -1),
    cards: num(p, "warnings"),
    tsi: num(p, "mkt"),
    // HRF speichert Geld in der Hattrick-Basiseinheit; CurrencyRate rechnet in die eigene Währung um (EUR: 10)
    salary: num(p, "sal") / currencyRate,
    transferListed: bool(p, "transferlisted"),
    lastMatchPosition: num(p, "lastmatch_positioncode"),
    lastMatchRating: num(p, "lastmatch_rating"),
    lastMatchDate: str(p, "lastmatch_date"),
    lastMatchMinutes: num(p, "lastmatch_playedminutes"),
    lastMatchId: num(p, "lastmatch_id"),
    number: num(p, "playernumber"),
  };
  // HO schätzt die Form-Unterstufe aus der TSI. Mit aktuellen TSI-Werten liefert die Formel
  // durchweg den Maximalwert, deshalb nehmen wir die neutrale Mitte (0,5).
  player.formSub = FORM_SUB_DEFAULT;
  return player;
}

export function parseHrf(text: string): Hrf {
  const sections = parseSections(text);
  const get = (name: string) => sections.find((s) => s.name === name)?.props ?? new Map<string, string>();
  const basics = get("basics");
  const league = get("league");
  const team = get("team");
  const xtra = get("xtra");
  const economy = get("economy");
  const lineup = get("lineup");
  const club = get("club");

  const formationExperience: Record<string, number> = {};
  for (const [k, v] of team) {
    const m = /^exper(\d{3})$/.exec(k);
    if (m) formationExperience[m[1]] = Number(v);
  }

  const trainerId = num(xtra, "trainerid", num(lineup, "trainer"));
  const currencyRate = num(xtra, "currencyrate", 1) || 1;
  const info: TeamInfo = {
    teamId: num(basics, "teamid"),
    teamName: str(basics, "teamname"),
    season: num(basics, "season"),
    matchRound: num(basics, "matchround"),
    leagueName: str(league, "serie"),
    leaguePosition: num(league, "placering"),
    teamSpirit: num(team, "stamningvalue"),
    confidence: num(team, "sjalvfortroendevalue"),
    trainingType: num(team, "trtypevalue"),
    trainingTypeName: str(team, "trtype"),
    trainingLevel: num(team, "trlevel"),
    staminaTrainingPart: num(team, "staminatrainingpart"),
    assistantsLevel: num(club, "hjtranare", -1),
    formationExperience,
    trainerId,
    trainerType: sections.find((x) => x.name === `player${trainerId}`)?.props.has("trainertype") ? num(get(`player${trainerId}`), "trainertype", -1) : -1,
    tacticalAssistants: num(club, "tacticalassistantlevels"),
    cash: num(economy, "cash") / currencyRate,
    expectedCash: economy.has("expectedcash") ? num(economy, "expectedcash") / currencyRate : null,
    costsBoughtPlayers: num(economy, "costsboughtplayers") / currencyRate,
    hrfDate: str(basics, "date"),
  };

  const players: Player[] = [];
  for (const s of sections) {
    const m = /^player(\d+)$/.exec(s.name);
    if (!m) continue;
    const id = Number(m[1]);
    if (id === trainerId) continue; // der Trainer steht als Spieler in der Datei, spielt aber nicht
    players.push(parsePlayer(s.props, id, currencyRate));
  }

  return {
    raw: text,
    team: info,
    players,
    lineupMatchId: num(lineup, "matchid"),
    lineupMatchType: num(lineup, "matchtyp"),
  };
}

// --- Aufstellung in HRF schreiben -------------------------------------------

const ROLE_KEYS: Record<number, [string, string]> = {
  [Role.keeper]: ["keeper", ""],
  [Role.rightBack]: ["rightBack", "order_rightback"],
  [Role.rightCentralDefender]: ["rightCentralDefender", "order_rightCentralDefender"],
  [Role.middleCentralDefender]: ["middleCentralDefender", "order_middleCentralDefender"],
  [Role.leftCentralDefender]: ["leftCentralDefender", "order_leftCentralDefender"],
  [Role.leftBack]: ["leftBack", "order_leftBack"],
  [Role.rightWinger]: ["rightwinger", "order_rightWinger"],
  [Role.rightInnerMidfield]: ["rightInnerMidfield", "order_rightInnerMidfield"],
  [Role.centralInnerMidfield]: ["middleInnerMidfield", "order_centralInnerMidfield"],
  [Role.leftInnerMidfield]: ["leftInnerMidfield", "order_leftInnerMidfield"],
  [Role.leftWinger]: ["leftwinger", "order_leftWinger"],
  [Role.rightForward]: ["rightForward", "order_rightForward"],
  [Role.centralForward]: ["centralForward", "order_centralForward"],
  [Role.leftForward]: ["leftForward", "order_leftForward"],
};

const BENCH_KEYS: Record<string, string> = {
  keeper: "substgk1",
  centralDefender: "substcd1",
  wingBack: "substwb1",
  innerMidfield: "substim1",
  forward: "substfw1",
  winger: "substwi1",
  extra: "substxt1",
};

/**
 * Baut den [lineup]-Abschnitt so, wie HO ihn beim HRF-Import liest
 * (HRFStringParser -> MatchRoleID.convertOldRoleToNew -> Lineup(Properties)).
 */
export function buildLineupSection(lineup: Lineup, teamId: number, trainerId: number, matchId: number, matchType: number): string {
  const kv: [string, string | number][] = [
    ["teamid", teamId],
    ["matchid", matchId],
    ["matchtyp", matchType],
    ["trainer", trainerId],
    ["installning", lineup.attitude],
    ["styleOfPlay", lineup.styleOfPlay],
    ["tactictype", lineup.tactic],
  ];
  const byRole = new Map(lineup.positions.map((p) => [p.role as number, p]));
  for (const [role, [key, orderKey]] of Object.entries(ROLE_KEYS)) {
    const pos = byRole.get(Number(role));
    kv.push([key, pos?.playerId ?? 0]);
    if (orderKey) kv.push([orderKey, pos?.behaviour ?? 0]);
  }
  for (const [slot, key] of Object.entries(BENCH_KEYS)) {
    kv.push([key, lineup.bench[slot as keyof typeof lineup.bench] ?? 0]);
  }
  const backups = validBackups(lineup.bench, lineup.backups);
  for (const [slot, key] of Object.entries(BENCH_BACKUP_KEYS)) kv.push([key, backups[slot as BenchSlot] ?? 0]);
  kv.push(["captain", lineup.captainId]);
  kv.push(["kicker1", lineup.setPiecesId]);
  kv.push(...orderKeys(lineup));
  return "[lineup]\n" + kv.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

/** Ersetzt den [lineup]-Abschnitt einer HRF-Datei; alle anderen Daten bleiben unverändert. */
export function writeLineupToHrf(hrf: Hrf, lineup: Lineup, matchId = hrf.lineupMatchId, matchType = hrf.lineupMatchType): string {
  const nl = hrf.raw.includes("\r\n") ? "\r\n" : "\n";
  const section = buildLineupSection(lineup, hrf.team.teamId, hrf.team.trainerId, matchId, matchType).replace(/\n/g, nl);
  const re = /\[lineup\][\s\S]*?(?=^\[)/m;
  if (re.test(hrf.raw)) return hrf.raw.replace(re, section);
  return hrf.raw.trimEnd() + nl + section;
}
