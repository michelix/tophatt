// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Schwachstellen: welche Mannschaftsteile fallen ab, und was würde eine Verstärkung dort bringen?

import type { Lineup, MatchSettings, Player } from "./model";
import { type LineupSector, type RatingSector, type SectorRatings, RATING_SECTORS, lineupSector } from "./rating";
import { Evaluator, hatStatsOf } from "./optimizer";
import type { TeamState } from "./rating";

export type Severity = "critical" | "warning" | "good";

export const SECTOR_DE: Record<RatingSector, string> = {
  defenceRight: "Abwehr rechts",
  defenceCentral: "Abwehr zentral",
  defenceLeft: "Abwehr links",
  midfield: "Mittelfeld",
  attackRight: "Angriff rechts",
  attackCentral: "Angriff zentral",
  attackLeft: "Angriff links",
};

type SkillKey = "keeper" | "defending" | "playmaking" | "passing" | "winger" | "scoring";
const SKILL_DE: Record<SkillKey, string> = {
  keeper: "Torwart",
  defending: "Verteidigung",
  playmaking: "Spielaufbau",
  passing: "Passspiel",
  winger: "Flügelspiel",
  scoring: "Torschuss",
};
const POS_DE: Record<LineupSector, string> = {
  goal: "Torwart",
  back: "Außenverteidiger",
  centralDefence: "Innenverteidiger",
  wing: "Flügelspieler",
  innerMidfield: "zentraler Mittelfeldspieler",
  forward: "Stürmer",
};

/** Welche Spieler/Fertigkeiten einen Mannschaftsteil tragen (Hauptbeiträge laut Bewertungsformel) */
const LEVERS: Record<RatingSector, { pos: LineupSector; skill: SkillKey }[]> = {
  midfield: [{ pos: "innerMidfield", skill: "playmaking" }, { pos: "wing", skill: "playmaking" }],
  defenceCentral: [{ pos: "centralDefence", skill: "defending" }, { pos: "goal", skill: "keeper" }, { pos: "back", skill: "defending" }],
  defenceLeft: [{ pos: "back", skill: "defending" }, { pos: "centralDefence", skill: "defending" }, { pos: "goal", skill: "keeper" }],
  defenceRight: [{ pos: "back", skill: "defending" }, { pos: "centralDefence", skill: "defending" }, { pos: "goal", skill: "keeper" }],
  attackCentral: [{ pos: "forward", skill: "scoring" }, { pos: "forward", skill: "passing" }, { pos: "innerMidfield", skill: "passing" }],
  attackLeft: [{ pos: "wing", skill: "winger" }, { pos: "forward", skill: "winger" }, { pos: "forward", skill: "scoring" }],
  attackRight: [{ pos: "wing", skill: "winger" }, { pos: "forward", skill: "winger" }, { pos: "forward", skill: "scoring" }],
};

export interface SectorAssessment {
  sector: RatingSector;
  name: string;
  rating: number;
  severity: Severity;
  /** Abstand zum Durchschnitt der sieben Teile */
  delta: number;
  /** stärkster Hebel: welche Position, welche Fertigkeit, wer spielt dort, Zuwachs bei +2 Stufen */
  lever: { position: string; skill: string; player: string; sectorGain: number; hatStatsGain: number } | null;
  advice: string;
}

export function assessSectors(players: Player[], lineup: Lineup, ratings: SectorRatings, settings: MatchSettings, team: TeamState): SectorAssessment[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const field = lineup.positions.map((p) => ({ player: byId.get(p.playerId)!, role: p.role, behaviour: p.behaviour })).filter((f) => f.player);
  const ev = new Evaluator(settings, team);
  const base = ev.ratings(field);
  const baseHs = hatStatsOf(base);
  const avg = RATING_SECTORS.reduce((s, k) => s + ratings[k], 0) / RATING_SECTORS.length;
  let fake = -500000;

  return RATING_SECTORS.map((sector) => {
    const rating = ratings[sector];
    const delta = rating - avg;
    // Mittelfeld zählt dreifach und entscheidet über den Ballbesitz: strenger bewerten
    const weight = sector === "midfield" ? 1.3 : 1;
    const severity: Severity = delta * weight <= -1 ? "critical" : delta * weight <= -0.4 ? "warning" : "good";

    let lever: SectorAssessment["lever"] = null;
    for (const { pos, skill } of LEVERS[sector]) {
      field.forEach((f, i) => {
        if (lineupSector(f.role) !== pos) return;
        const boosted = { ...f.player, id: fake--, [skill]: f.player[skill] + 2 };
        const f2 = field.map((g, j) => (j === i ? { ...g, player: boosted } : g));
        const r2 = ev.ratings(f2);
        const gain = r2[sector] - base[sector];
        if (!lever || gain > lever.sectorGain)
          lever = { position: POS_DE[pos], skill: SKILL_DE[skill], player: f.player.name, sectorGain: gain, hatStatsGain: hatStatsOf(r2) - baseHs };
      });
    }
    const l = lever as SectorAssessment["lever"];
    const advice =
      severity === "good"
        ? "Kein Handlungsbedarf."
        : l
          ? `Ein ${l.position} mit 2 Stufen mehr ${l.skill} als ${l.player} hebt diesen Teil um ${l.sectorGain.toFixed(1)} (${l.hatStatsGain >= 0 ? "+" : ""}${l.hatStatsGain.toFixed(1)} HatStats).`
          : "Mit der aktuellen Formation spielt hier niemand.";
    return { sector, name: SECTOR_DE[sector], rating, severity, delta, lever: l, advice };
  });
}
