// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Transfer-Suchprofil: aus Schwachstellen und Kaderplanung konkrete Filterwerte für den Transfermarkt ableiten.

import type { Player } from "./model";
import type { LineupSector } from "./rating";
import { DEV_SKILL_DE, type DevSkill } from "./development";
import type { GroupPlan } from "./squad";
import { GROUP_DE } from "./squad";
import type { SectorAssessment } from "./weakness";

/** Hauptfertigkeit und wichtigste Nebenfertigkeiten je Positionsgruppe */
const SKILLS: Record<LineupSector, { main: DevSkill; secondary: DevSkill[] }> = {
  goal: { main: "keeper", secondary: ["setPieces"] },
  centralDefence: { main: "defending", secondary: ["playmaking"] },
  back: { main: "defending", secondary: ["winger"] },
  innerMidfield: { main: "playmaking", secondary: ["passing", "defending"] },
  wing: { main: "winger", secondary: ["playmaking"] },
  forward: { main: "scoring", secondary: ["passing"] },
};

/** Welche Gruppe einen Mannschaftsteil am stärksten trägt */
const SECTOR_GROUP: Record<string, LineupSector> = {
  midfield: "innerMidfield",
  defenceCentral: "centralDefence",
  defenceLeft: "back",
  defenceRight: "back",
  attackCentral: "forward",
  attackLeft: "wing",
  attackRight: "wing",
};

export interface SkillRange {
  skill: DevSkill;
  name: string;
  min: number;
  max?: number;
}

export interface SearchProfile {
  group: LineupSector;
  title: string;
  reason: string;
  /** sofort helfen oder langfristig aufbauen */
  kind: "sofort" | "langfristig";
  age: [number, number];
  skills: SkillRange[];
  priority: number;
}

export interface Budget {
  cash: number;
  weeklyWages: number;
  /** Rücklage: fünf Wochen Gehälter */
  reserve: number;
  available: number;
}

/**
 * @param cash Kontostand; besser der erwartete Kontostand zum Wochenende (HRF ExpectedCash), denn Käufe
 *   dieser Woche sind im Kontostand der HRF noch nicht abgezogen.
 */
export function budget(players: Player[], cash: number): Budget {
  const weeklyWages = players.reduce((s, p) => s + p.salary, 0);
  const reserve = weeklyWages * 5;
  return { cash, weeklyWages, reserve, available: Math.max(0, cash - reserve) };
}

const groupPlayers = (plan: GroupPlan) => plan.horizons[0].starters.map((e) => e.id);

/**
 * Suchprofile, wichtigste zuerst. Ziel für die Hauptfertigkeit: zwei Stufen über dem schwächsten Stammspieler
 * (eine Stufe Verbesserung, eine Stufe, weil gekaufte Spieler anfangs keine Treue haben).
 */
export function searchProfiles(players: Player[], weak: SectorAssessment[], plans: GroupPlan[]): SearchProfile[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: SearchProfile[] = [];
  const make = (group: LineupSector, kind: SearchProfile["kind"], reason: string, priority: number) => {
    if (out.some((x) => x.group === group && x.kind === kind)) return;
    const plan = plans.find((x) => x.group === group);
    const starters = (plan ? groupPlayers(plan) : []).map((id) => byId.get(id)!).filter(Boolean);
    const { main, secondary } = SKILLS[group];
    const weakest = starters.length ? Math.min(...starters.map((p) => p[main])) : 5;
    const best = starters.length ? Math.max(...starters.map((p) => p[main])) : 5;
    const target = kind === "sofort" ? Math.max(weakest + 2, best + 1) : Math.max(weakest + 1, best);
    const skills: SkillRange[] = [
      kind === "sofort"
        ? { skill: main, name: DEV_SKILL_DE[main], min: target, max: target + 1 }
        : { skill: main, name: DEV_SKILL_DE[main], min: Math.max(4, target - 2), max: target },
    ];
    for (const sk of secondary) {
      const avg = starters.length ? Math.round(starters.reduce((s, p) => s + p[sk], 0) / starters.length) : 4;
      skills.push({ skill: sk, name: DEV_SKILL_DE[sk], min: Math.max(3, avg - (kind === "langfristig" ? 1 : 0)) });
    }
    out.push({
      group,
      title: `${GROUP_DE[group]}: ${kind === "sofort" ? "Verstärkung für sofort" : "Nachfolger zum Aufbauen"}`,
      reason,
      kind,
      age: kind === "sofort" ? [27, 30] : [19, 23],
      skills,
      priority,
    });
  };

  // 1. Schwache Mannschaftsteile: sofortige Verstärkung
  for (const w of [...weak].filter((x) => x.severity !== "good").sort((a, b) => a.delta - b.delta)) {
    const g = SECTOR_GROUP[w.sector];
    make(g, "sofort", `${w.name} ist ${w.severity === "critical" ? "die größte Schwachstelle" : "unter dem Durchschnitt"} (${w.rating.toFixed(2)}).`, w.severity === "critical" ? 1 : 2);
  }
  // 2. Kaderplanung: Lücken in ein bis zwei Saisons → Nachfolger aufbauen
  for (const p of plans.filter((x) => x.severity !== "good")) {
    make(p.group, "langfristig", p.note, p.severity === "critical" ? 2 : 3);
  }
  return out.sort((a, b) => a.priority - b.priority);
}
