// Trainingsplanung: welche Positionen werden beim eingestellten Training voll/teilweise trainiert,
// und eine Freundschaftsspiel-Aufstellung, damit alle 22 Spieler Training bekommen.
// Positionsgruppen je Trainingsart aus HO core/training/type/*WeeklyTraining.java.

import type { BehaviourId, Lineup, Player, RoleId } from "./model";
import { Behaviour, Role } from "./model";
import { type LineupSector, lineupSector, playerPositionRating } from "./rating";
import { FORMATIONS, formationVariants, isAvailable, pickCaptain, pickSetPieces } from "./optimizer";

type SkillKey = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring" | "setPieces";

export interface TrainingDef {
  name: string;
  skill: SkillKey;
  full: LineupSector[];
  partly: LineupSector[];
}

export const TRAININGS: Record<number, TrainingDef> = {
  2: { name: "Standards", skill: "setPieces", full: ["goal", "back", "centralDefence", "wing", "innerMidfield", "forward"], partly: [] },
  3: { name: "Verteidigung", skill: "defending", full: ["centralDefence", "back"], partly: [] },
  4: { name: "Torschuss", skill: "scoring", full: ["forward"], partly: [] },
  5: { name: "Flanken", skill: "winger", full: ["wing"], partly: ["back"] },
  6: { name: "Schusstraining", skill: "scoring", full: ["goal", "back", "centralDefence", "wing", "innerMidfield", "forward"], partly: [] },
  7: { name: "Kurzpässe", skill: "passing", full: ["wing", "innerMidfield", "forward"], partly: [] },
  8: { name: "Spielaufbau", skill: "playmaking", full: ["innerMidfield"], partly: ["wing"] },
  9: { name: "Torwart", skill: "keeper", full: ["goal"], partly: [] },
  10: { name: "Steilpässe", skill: "passing", full: ["back", "centralDefence", "wing", "innerMidfield"], partly: [] },
  11: { name: "Defensives Stellungsspiel", skill: "defending", full: ["goal", "back", "centralDefence", "wing", "innerMidfield"], partly: [] },
  12: { name: "Angriff über die Flügel", skill: "winger", full: ["wing", "forward"], partly: [] },
};

export type TrainingLevel = "voll" | "teilweise" | "keins";

export function trainingFor(role: number, t: TrainingDef): TrainingLevel {
  const s = lineupSector(role);
  if (t.full.includes(s)) return "voll";
  if (t.partly.includes(s)) return "teilweise";
  return "keins";
}

/**
 * Trainingswürdigkeit: jung + Trainingsfertigkeit ist eine seiner Hauptfertigkeiten.
 * Ergebnis grob 0..10, nur zum Sortieren.
 */
export function trainingPriority(p: Player, t: TrainingDef): number {
  const skills: SkillKey[] = ["keeper", "defending", "playmaking", "passing", "winger", "scoring"];
  const sorted = [...skills].sort((a, b) => p[b] - p[a]);
  const rank = sorted.indexOf(t.skill as SkillKey);
  const relevance = t.skill === "setPieces" ? 1 : rank === 0 ? 1 : rank === 1 ? 0.7 : rank === 2 ? 0.4 : 0.15;
  const youth = Math.max(0, 31 - p.age) / 13; // 18 J. = 1,0 ; 31 J. = 0
  return 10 * relevance * (0.4 + 0.6 * youth);
}

export interface FriendlyPlan {
  lineup: Lineup;
  /** Spieler, die in der Liga schon auf einer Trainingsposition spielen */
  trainedInLeague: number[];
  /** Spieler, die im Freundschaftsspiel auf einer Trainingsposition stehen */
  trainedInFriendly: number[];
  /** Spieler, die diese Woche kein Training bekommen */
  untrained: number[];
  notes: string[];
}

/**
 * Freundschaftsspiel: Spieler, die in der Liga nicht (oder nicht auf einer Trainingsposition) spielen,
 * kommen auf die Trainingspositionen. Formation mit möglichst vielen Trainingsplätzen.
 */
export function planFriendly(players: Player[], league: Lineup, trainingType: number, allowBruised = false): FriendlyPlan {
  const t = TRAININGS[trainingType];
  const notes: string[] = [];
  if (!t) throw new Error(`Unbekannte Trainingsart ${trainingType}`);

  const available = players.filter((p) => isAvailable(p, allowBruised));
  const leagueIds = new Set(league.positions.map((p) => p.playerId));
  const trainedInLeague = league.positions.filter((p) => trainingFor(p.role, t) === "voll").map((p) => p.playerId);
  const trainedSet = new Set(trainedInLeague);

  // Formation mit den meisten vollen Trainingsplätzen
  let bestRoles: RoleId[] = [];
  let bestCount = -1;
  let bestFormation = "442";
  for (const f of FORMATIONS) {
    for (const roles of formationVariants(f)) {
      const full = roles.filter((r) => trainingFor(r, t) === "voll").length;
      const partly = roles.filter((r) => trainingFor(r, t) === "teilweise").length;
      const v = full * 10 + partly;
      if (v > bestCount) {
        bestCount = v;
        bestRoles = roles;
        bestFormation = f;
      }
    }
  }

  const trainingRoles = bestRoles.filter((r) => trainingFor(r, t) === "voll");
  const otherRoles = bestRoles.filter((r) => trainingFor(r, t) !== "voll");

  // Kandidaten: zuerst Nicht-Liga-Spieler, sortiert nach Trainingswürdigkeit
  const nonLeague = available.filter((p) => !leagueIds.has(p.id));
  const leagueUntrained = available.filter((p) => leagueIds.has(p.id) && !trainedSet.has(p.id));
  const byPrio = (a: Player, b: Player) => trainingPriority(b, t) - trainingPriority(a, t);

  const used = new Set<number>();
  const assign: { role: RoleId; player: Player }[] = [];

  // Torwart-Rolle gesondert: ein Torwart muss ins Tor
  const fillRole = (role: RoleId, candidates: Player[]) => {
    let best: Player | null = null,
      bv = -1;
    for (const p of candidates) {
      if (used.has(p.id)) continue;
      const v = playerPositionRating(p, role);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      assign.push({ role, player: best });
    }
    return best;
  };

  // 1) Trainingsplätze: trainingswürdigste Nicht-Liga-Spieler, dann Liga-Spieler ohne Training
  const trainees = [...nonLeague.sort(byPrio), ...leagueUntrained.sort(byPrio)].filter((p) => trainingFor(Role.keeper, t) === "voll" || p.keeper < Math.max(p.defending, p.playmaking, p.winger, p.scoring, p.passing));
  for (const role of trainingRoles) {
    if (role === Role.keeper) {
      fillRole(role, [...nonLeague, ...leagueUntrained]);
      continue;
    }
    // aus den nächsten Trainees den nehmen, der auf dieser Position am besten passt
    const next = trainees.filter((p) => !used.has(p.id)).slice(0, 3);
    fillRole(role, next.length ? next : available);
  }
  // 2) restliche Plätze: Nicht-Liga-Spieler nach Positionsstärke, notfalls Liga-Spieler
  for (const role of otherRoles) {
    if (!fillRole(role, nonLeague)) fillRole(role, available);
  }

  const lineup: Lineup = {
    formation: bestFormation,
    positions: assign.map((a) => ({ role: a.role, playerId: a.player.id, behaviour: Behaviour.normal as BehaviourId })).sort((a, b) => a.role - b.role),
    bench: {},
    captainId: pickCaptain(assign.map((a) => a.player)),
    setPiecesId: pickSetPieces(assign.filter((a) => a.role !== Role.keeper).map((a) => a.player)),
    tactic: 0,
    attitude: 0,
    styleOfPlay: 0,
  };

  const trainedInFriendly = assign.filter((a) => trainingFor(a.role, t) === "voll").map((a) => a.player.id);
  const trainedAll = new Set([...trainedInLeague, ...trainedInFriendly]);
  const untrained = available.filter((p) => !trainedAll.has(p.id)).map((p) => p.id);

  if (assign.length < 11) notes.push(`Nur ${assign.length} einsatzfähige Spieler für das Freundschaftsspiel.`);
  const doubles = assign.filter((a) => leagueIds.has(a.player.id));
  if (doubles.length) notes.push(`${doubles.length} Spieler müssten in Liga und Freundschaftsspiel ran (Verletzungsrisiko).`);
  notes.push(
    `Pro Woche können höchstens ${trainingRoles.length + trainedInLeague.length} Spieler voll „${t.name}“ trainieren (${trainedInLeague.length} in der Liga, ${trainingRoles.length} im Freundschaftsspiel).`,
  );
  notes.push("Freundschaftsspiele sind nur in Wochen ohne Pokalspiel möglich.");
  return { lineup, trainedInLeague, trainedInFriendly, untrained, notes };
}
