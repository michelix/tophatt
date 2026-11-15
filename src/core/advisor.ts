// Kader- und Transferberater (erste Heuristiken, kein HO-Algorithmus).
// 1) Wo bringt eine Verstärkung am meisten?  -> Simulation "+1 / +2 Stufen" auf jeder Startposition
// 2) Wer ist entbehrlich?                   -> nicht in Startelf/Bank, alt, Gehalt
// 3) Wer lohnt sich zu trainieren?          -> jung + Trainingsfertigkeit

import type { Lineup, MatchSettings, Player } from "./model";
import { type TeamState, lineupSector, playerPositionRating } from "./rating";
import { Role } from "./model";
import { Evaluator, HATSTATS_OBJECTIVE, hatStatsOf } from "./optimizer";
import { TRAININGS, trainingPriority } from "./training";

type SkillKey = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring";

const MAIN_SKILLS: Record<string, SkillKey[]> = {
  goal: ["keeper"],
  back: ["defending", "winger"],
  centralDefence: ["defending"],
  wing: ["winger", "playmaking"],
  innerMidfield: ["playmaking", "passing"],
  forward: ["scoring", "passing"],
};

const SKILL_DE: Record<SkillKey, string> = {
  keeper: "Torwart",
  defending: "Verteidigung",
  playmaking: "Spielaufbau",
  passing: "Passspiel",
  winger: "Flügelspiel",
  scoring: "Torschuss",
};

const POS_DE: Record<string, string> = {
  goal: "Torwart",
  back: "Außenverteidiger",
  centralDefence: "Innenverteidiger",
  wing: "Flügelspieler",
  innerMidfield: "Zentrales Mittelfeld",
  forward: "Sturm",
};

export interface UpgradeHint {
  position: string;
  currentPlayer: string;
  skill: string;
  gainPlus1: number;
  gainPlus2: number;
}

export interface SquadHint {
  playerId: number;
  name: string;
  reason: string;
}

export interface Advice {
  upgrades: UpgradeHint[];
  sellCandidates: SquadHint[];
  trainingTargets: SquadHint[];
  summary: string[];
}

export function advise(players: Player[], lineup: Lineup, settings: MatchSettings, team: TeamState, trainingType: number): Advice {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ev = new Evaluator(settings, team);
  const field = lineup.positions.map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour })).filter((f) => f.player);
  const base = hatStatsOf(ev.ratings(field));

  // 1) Verstärkungs-Simulation
  const upgrades: UpgradeHint[] = [];
  const seenSector = new Set<string>();
  const candidates: UpgradeHint[] = [];
  for (let i = 0; i < field.length; i++) {
    const sector = lineupSector(field[i].role);
    for (const skill of MAIN_SKILLS[sector]) {
      const gain = (delta: number) => {
        // eigene Fantasie-ID je Variante, damit der Beitrags-Cache nicht greift
        const boosted = { ...field[i].player, id: -(1000 * delta + 10 * i + MAIN_SKILLS[sector].indexOf(skill) + 1), [skill]: field[i].player[skill] + delta };
        const f2 = field.map((f, j) => (j === i ? { ...f, player: boosted } : f));
        return hatStatsOf(ev.ratings(f2)) - base;
      };
      candidates.push({
        position: POS_DE[sector],
        currentPlayer: field[i].player.name,
        skill: SKILL_DE[skill],
        gainPlus1: gain(1),
        gainPlus2: gain(2),
      });
    }
  }
  candidates.sort((a, b) => b.gainPlus2 - a.gainPlus2);
  for (const c of candidates) {
    const key = c.position + c.skill;
    if (seenSector.has(key)) continue;
    seenSector.add(key);
    upgrades.push(c);
    if (upgrades.length >= 5) break;
  }

  // 2) Entbehrliche Spieler
  const inLineup = new Set([...lineup.positions.map((p) => p.playerId), ...Object.values(lineup.bench)]);
  const sellCandidates: SquadHint[] = [];
  for (const p of players) {
    if (inLineup.has(p.id)) continue;
    const reasons: string[] = [];
    if (p.age >= 28) reasons.push(`${p.age} Jahre, entwickelt sich kaum noch`);
    if (p.salary >= 1000) reasons.push(`Gehalt ${Math.round(p.salary).toLocaleString("de-DE")} €/Woche`);
    // Verletzte sind nur vorübergehend nicht in der Elf – kein Verkaufsgrund
    if (p.injury > 0) continue;
    if (reasons.length) sellCandidates.push({ playerId: p.id, name: p.name, reason: `Weder Startelf noch Bank; ${reasons.join(", ")}.` });
  }
  const keepers = players.filter((p) => p.keeper >= Math.max(p.defending, p.playmaking, p.scoring, p.winger, p.passing));
  if (keepers.length > 2) {
    // die zwei stärksten Torhüter (inkl. Form, Treue, Erfahrung) behalten
    const sorted = [...keepers].sort((a, b) => playerPositionRating(b, Role.keeper) - playerPositionRating(a, Role.keeper));
    for (const k of sorted.slice(2)) {
      if (!sellCandidates.some((s) => s.playerId === k.id) && !inLineup.has(k.id))
        sellCandidates.push({ playerId: k.id, name: k.name, reason: `${keepers.length} Torhüter im Kader, zwei reichen. Gehalt ${Math.round(k.salary).toLocaleString("de-DE")} €/Woche.` });
    }
  }

  // 3) Trainingskandidaten
  const t = TRAININGS[trainingType];
  const trainingTargets: SquadHint[] = [];
  if (t) {
    const isKeeper = (p: Player) => p.keeper > Math.max(p.defending, p.playmaking, p.scoring, p.winger, p.passing);
    const ranked = [...players].filter((p) => p.injury <= 0 && (t.skill === "keeper" || !isKeeper(p))).sort((a, b) => trainingPriority(b, t) - trainingPriority(a, t));
    for (const p of ranked.slice(0, 6)) {
      trainingTargets.push({ playerId: p.id, name: p.name, reason: `${p.age} Jahre, ${t.name} ${p[t.skill]} – lohnt sich zu trainieren.` });
    }
  }

  const summary: string[] = [];
  if (upgrades[0])
    summary.push(
      `Größter Hebel: ${upgrades[0].position} (${upgrades[0].skill}). Ein Spieler mit +2 Stufen gegenüber ${upgrades[0].currentPlayer} bringt etwa +${upgrades[0].gainPlus2.toFixed(1)} HatStats.`,
    );
  if (sellCandidates.length) summary.push(`${sellCandidates.length} Spieler kommen weder in die Startelf noch auf die Bank – Verkauf prüfen, das spart Gehalt.`);
  return { upgrades, sellCandidates, trainingTargets, summary };
}
