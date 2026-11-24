// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright © 2026 michelix
// Transfer-Suchprofil: aus Schwachstellen und Kaderplanung konkrete Filterwerte für den Transfermarkt ableiten.

import type { Player } from "./model";
import type { LineupSector } from "./rating";
import { DEV_SKILL_DE, type DevSkill } from "./development";
import type { GroupPlan } from "./squad";
import { GROUP_DE } from "./squad";
import type { SectorAssessment } from "./weakness";
import type { GroupNeed, SquadPlan } from "./squadplan";

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
  /** Lücke im Kader schließen (Ersatzniveau), sofort helfen oder langfristig aufbauen */
  kind: "luecke" | "sofort" | "langfristig";
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
 * Mit `squad` (Seite Kaderplanung) kommen Lücken und Nachfolger aus derselben Planung wie dort,
 * sonst aus der älteren Gruppen-Planung `plans`.
 */
export function searchProfiles(players: Player[], weak: SectorAssessment[], plans: GroupPlan[], squad: SquadPlan | null = null): SearchProfile[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out: SearchProfile[] = [];
  const startersOf = (group: LineupSector): Player[] => {
    const need = squad?.groups.find((x) => x.group === group);
    if (need) return need.starters.map((x) => x.player);
    const plan = plans.find((x) => x.group === group);
    return (plan ? groupPlayers(plan) : []).map((id) => byId.get(id)!).filter(Boolean);
  };
  const make = (group: LineupSector, kind: SearchProfile["kind"], reason: string, priority: number) => {
    if (out.some((x) => x.group === group && x.kind === kind)) return;
    const starters = startersOf(group);
    const { main, secondary } = SKILLS[group];
    const weakest = starters.length ? Math.min(...starters.map((p) => p[main])) : 5;
    const best = starters.length ? Math.max(...starters.map((p) => p[main])) : 5;
    let skills: SkillRange[];
    let age: [number, number];
    let title: string;
    if (kind === "luecke") {
      // Ersatz: gleichwertig ab 85 % des schwächsten Stammspielers, also etwa eine Stufe darunter bis gleich stark
      skills = [{ skill: main, name: DEV_SKILL_DE[main], min: Math.max(3, weakest - 1), max: Math.max(3, weakest) }];
      age = [24, 31];
      title = `${GROUP_DE[group]}: Ersatz für die Lücke`;
    } else {
      const target = kind === "sofort" ? Math.max(weakest + 2, best + 1) : Math.max(weakest + 1, best);
      skills = [
        kind === "sofort"
          ? { skill: main, name: DEV_SKILL_DE[main], min: target, max: target + 1 }
          : { skill: main, name: DEV_SKILL_DE[main], min: Math.max(4, target - 2), max: target },
      ];
      age = kind === "sofort" ? [27, 30] : [19, 23];
      title = `${GROUP_DE[group]}: ${kind === "sofort" ? "Verstärkung für sofort" : "Nachfolger zum Aufbauen"}`;
    }
    for (const sk of secondary) {
      const avg = starters.length ? Math.round(starters.reduce((s, p) => s + p[sk], 0) / starters.length) : 4;
      skills.push({ skill: sk, name: DEV_SKILL_DE[sk], min: Math.max(3, avg - (kind === "sofort" ? 0 : 1)) });
    }
    out.push({ group, title, reason, kind, age, skills, priority });
  };

  // 1. Lücken laut Kaderplanung: zu wenig brauchbarer Ersatz
  for (const n of squad?.groups.filter((x) => x.missing > 0) ?? []) {
    make(n.group, "luecke", `Kaderplanung: ${n.missing} Spieler ${n.missing === 1 ? "fehlt" : "fehlen"}. Für ${n.places} ${n.places === 1 ? "Platz" : "Plätze"} gibt es ${n.backups.length ? `nur ${n.backups.length} brauchbaren Ersatz` : "keinen brauchbaren Ersatz"}. Ersatzniveau reicht, das ist meist günstig.`, 0);
  }
  // 2. Schwache Mannschaftsteile: sofortige Verstärkung
  for (const w of [...weak].filter((x) => x.severity !== "good").sort((a, b) => a.delta - b.delta)) {
    const g = SECTOR_GROUP[w.sector];
    const need = squad?.groups.find((x) => x.group === g);
    make(g, "sofort", `${w.name} ist ${w.severity === "critical" ? "die größte Schwachstelle" : "unter dem Durchschnitt"} (${w.rating.toFixed(2)}).${crowdedNote(need)}`, w.severity === "critical" ? 1 : 2);
  }
  // 3. Nachfolger: Stammspieler, die deutlich abbauen, ohne Nachfolger im Kader
  if (squad) {
    for (const n of squad.groups) {
      const fading = n.starters.filter((x) => x.now > 0 && (x.now - x.later) / x.now >= 0.1);
      if (!fading.length) continue;
      const heir = [...n.talents, ...n.backups].some((x) => x.later >= Math.min(...fading.map((f) => f.later)));
      if (heir) continue;
      make(n.group, "langfristig", `${fading.map((f) => `${f.player.name} (${f.player.age})`).join(", ")} ${fading.length === 1 ? "verliert" : "verlieren"} bis in zwei Saisons mindestens 10 % Stärke, im Kader rückt niemand nach.`, 3);
    }
  } else {
    for (const p of plans.filter((x) => x.severity !== "good")) make(p.group, "langfristig", p.note, p.severity === "critical" ? 2 : 3);
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Hinweis, wenn ein Mannschaftsteil zahlenmäßig voll ist, aber zu schwach: kaufen und dort verkaufen */
function crowdedNote(n: GroupNeed | undefined): string {
  if (!n || !n.surplus.length) return "";
  const count = n.starters.length + n.backups.length + n.talents.length + n.surplus.length;
  return ` Spieler gibt es dort genug (${count}, davon ${n.surplus.length} überzählig), aber keiner ist stark genug. Nach dem Kauf dort verkaufen.`;
}
