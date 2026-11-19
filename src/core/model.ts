// Datenmodell des Prototyps. Feldnamen sind deutsch/englisch gemischt wie in Hattrick üblich,
// die HRF-Schlüssel (schwedisch, aus HO) werden nur im Parser verwendet.

export enum Specialty {
  None = 0,
  Technical = 1, // Ballzauberer
  Quick = 2, // schnell
  Powerful = 3, // durchsetzungsstark
  Unpredictable = 4, // unberechenbar
  Head = 5, // Kopfballstark
  Regainer = 6, // Balleroberer
  Support = 8, // Teamplayer
}

export interface Player {
  id: number;
  name: string;
  age: number;
  ageDays: number;
  /** Fähigkeiten in Hattrick-Stufen (1 = katastrophal ... 20 = göttlich), ohne Nachkommastellen aus HRF */
  keeper: number;
  defending: number;
  playmaking: number;
  passing: number;
  winger: number;
  scoring: number;
  setPieces: number;
  experience: number;
  leadership: number;
  form: number;
  /** geschätzte Nachkommastelle der Form (aus TSI, wie HO) */
  formSub: number;
  stamina: number;
  loyalty: number;
  homegrown: boolean;
  specialty: Specialty;
  specialtyLabel: string;
  /** -1 = fit, 0 = angeschlagen (Pflaster), >0 = Wochen verletzt */
  injury: number;
  /** Gelbe Karten (3 = gesperrt) */
  cards: number;
  tsi: number;
  salary: number;
  transferListed: boolean;
  lastMatchPosition: number;
  lastMatchRating: number;
}

export interface TeamInfo {
  teamId: number;
  teamName: string;
  season: number;
  matchRound: number;
  leagueName: string;
  leaguePosition: number;
  /** 0 = am Boden ... 10 = paradiesisch */
  teamSpirit: number;
  /** 0 = nicht vorhanden ... 9 */
  confidence: number;
  trainingType: number;
  trainingTypeName: string;
  trainingLevel: number;
  staminaTrainingPart: number;
  /** Summe der Co-Trainer-Stufen (hjTranare), -1 = unbekannt */
  assistantsLevel: number;
  /** Formationserfahrung, Schlüssel z. B. "442" */
  formationExperience: Record<string, number>;
  trainerId: number;
  /** Trainertyp laut HRF: 0 = defensiv, 1 = offensiv, 2 = ausgeglichen, -1 = unbekannt */
  trainerType: number;
  /** Stufen der Taktik-Assistenten (0 … 5) */
  tacticalAssistants: number;
  cash: number;
  /** erwarteter Kontostand zum Ende der Woche (inkl. Käufen/Verkäufen dieser Woche), null = unbekannt */
  expectedCash: number | null;
  /** Ausgaben für gekaufte Spieler in dieser Woche */
  costsBoughtPlayers: number;
  hrfDate: string;
}

export interface Hrf {
  raw: string;
  team: TeamInfo;
  players: Player[];
  /** Spiel-ID der in HRF hinterlegten nächsten Aufstellung */
  lineupMatchId: number;
  lineupMatchType: number;
}

// --- Aufstellung -------------------------------------------------------------

export const Role = {
  keeper: 100,
  rightBack: 101,
  rightCentralDefender: 102,
  middleCentralDefender: 103,
  leftCentralDefender: 104,
  leftBack: 105,
  rightWinger: 106,
  rightInnerMidfield: 107,
  centralInnerMidfield: 108,
  leftInnerMidfield: 109,
  leftWinger: 110,
  rightForward: 111,
  centralForward: 112,
  leftForward: 113,
} as const;
export type RoleId = (typeof Role)[keyof typeof Role];

export const Behaviour = {
  normal: 0,
  offensive: 1,
  defensive: 2,
  towardsMiddle: 3,
  towardsWing: 4,
} as const;
export type BehaviourId = (typeof Behaviour)[keyof typeof Behaviour];

export const Tactic = {
  normal: 0,
  pressing: 1,
  counter: 2,
  attackMiddle: 3,
  attackWings: 4,
  creative: 7,
  longShots: 8,
} as const;
export type TacticId = (typeof Tactic)[keyof typeof Tactic];

export const Attitude = { pic: -1, normal: 0, mots: 1 } as const;
export type AttitudeId = (typeof Attitude)[keyof typeof Attitude];

export const Location = { away: 0, home: 1, awayDerby: 2, neutral: 4 } as const;
export type LocationId = (typeof Location)[keyof typeof Location];

export interface FieldPosition {
  role: RoleId;
  playerId: number;
  behaviour: BehaviourId;
}

export type BenchSlot = "keeper" | "centralDefender" | "wingBack" | "innerMidfield" | "forward" | "winger" | "extra";

export interface Lineup {
  formation: string;
  positions: FieldPosition[];
  bench: Partial<Record<BenchSlot, number>>;
  captainId: number;
  setPiecesId: number;
  tactic: TacticId;
  attitude: AttitudeId;
  /** -10 (defensiv) ... 0 (ausgewogen) ... 10 (offensiv) */
  styleOfPlay: number;
}

export interface MatchSettings {
  location: LocationId;
  tactic: TacticId;
  attitude: AttitudeId;
  styleOfPlay: number;
  /** Zusätzliche Viertel-Stufen der Teamstimmung (HO-Standard: 2 = 0,5) */
  teamSpiritSubIndex: number;
}

export const defaultMatchSettings: MatchSettings = {
  location: Location.home,
  tactic: Tactic.normal,
  attitude: Attitude.normal,
  styleOfPlay: 0,
  teamSpiritSubIndex: 2,
};

/**
 * Erlaubte Ausrichtungen (styleOfPlay, -10 … 10) wie in HO (MatchAndLineupSelectionPanel.getValidStyleOfPlayValues):
 * hängen vom Trainertyp und von den Taktik-Assistenten ab, je Assistentenstufe 2 Schritte (ausgeglichen: 1 je Seite).
 */
export function styleRange(t: Pick<TeamInfo, "trainerType" | "tacticalAssistants">): [number, number] {
  const a = Math.max(0, t.tacticalAssistants);
  switch (t.trainerType) {
    case 0:
      return [-10, -10 + 2 * a];
    case 1:
      return [10 - 2 * a, 10];
    case 2:
      return [a ? -a : 0, a];
    default:
      return [-10, 10];
  }
}
