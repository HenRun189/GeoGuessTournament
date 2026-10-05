// Shared domain types used by engine, server and web.

export type TournamentState = 'SETUP' | 'PRELIMINARY' | 'SEMIFINALS' | 'FINAL' | 'FINISHED';

export type Stage = 'PRELIMINARY' | 'SEMIFINALS' | 'FINAL';

export type MatchStatus = 'waiting' | 'live' | 'finished';

export type TournamentFormat = 'round_robin' | 'random_three' | 'groups_of_3';

/** What a participant unit is: a single player or a 2-player team. */
export type UnitKind = 'player' | 'team';

export interface ParticipantInput {
  name: string;
  country?: string | null;
  abbreviation?: string | null;
}

export interface TeamInput {
  name: string;
  abbreviation?: string | null;
  country?: string | null;
  memberIds: string[]; // participant ids (1 or 2 members)
}

export interface CreateTournamentInput {
  name: string;
  participantCount: number; // 4..12
  participants: ParticipantInput[];
  teams?: TeamInput[] | null; // required for sizes 8, 10, 12
}

export interface UnitDTO {
  id: string;
  kind: UnitKind;
  name: string;
  abbreviation: string | null;
  country: string | null;
  members: { id: string; name: string }[];
}

export interface StandingRowDTO {
  position: number; // 0 = tied group marker, still increasing numbers
  unitId: string;
  name: string;
  country: string | null;
  abbreviation: string | null;
  played: number;
  wins: number;
  damageDealt: number;
  damageTaken: number;
  tied: boolean;
}

export interface MatchDTO {
  id: string;
  stage: Stage;
  round: number; // 1-based within stage
  orderInStage: number;
  label: string; // e.g. "Match 3"
  aUnitId: string | null;
  bUnitId: string | null;
  status: MatchStatus;
  result: MatchResultDTO | null;
  slotA: SlotRef | null;
  slotB: SlotRef | null;
}

export interface MatchResultDTO {
  winnerUnitId: string;
  aDamageDealt: number;
  bDamageDealt: number;
  aDamageTaken: number; // = bDamageDealt for 1v1 unit matches
  bDamageTaken: number;
}

/** Where a semifinal slot comes from: a final standing position or a group position. */
export interface SlotRef {
  kind: 'standing' | 'group';
  standing?: number; // overall rank position, e.g. 1..4
  groupId?: string;
  groupPosition?: number; // 1..3 within group
}

export interface GroupDTO {
  id: string;
  name: string;
  unitIds: string[];
}

export interface TournamentStateDTO {
  id: string;
  name: string;
  state: TournamentState;
  format: TournamentFormat;
  unitKind: UnitKind;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
  units: UnitDTO[];
  groups: GroupDTO[];
  matches: MatchDTO[];
  standings: StandingRowDTO[]; // overall preliminary standings (or per-group via groups)
  groupStandings: Record<string, StandingRowDTO[]>;
  knockout: KnockoutDTO | null;
  settings: OverlaySettingsDTO;
  currentMatchId: string | null;
  seed: number | null; // matchup-generation seed for 7/9/11, stored permanently
  playerViews: Record<string, PlayerViewDTO>; // JSON-safe, player-specific live views (derived)
}

export interface SemifinalPair {
  sf1: { a: SlotRef; b: SlotRef } | null;
  sf2: { a: SlotRef; b: SlotRef } | null;
}

export interface KnockoutDTO {
  sf1: MatchDTO | null;
  sf2: MatchDTO | null;
  final: MatchDTO | null;
  championUnitId: string | null;
  eliminatedUnitIds: string[];
}

export interface OverlaySettingsDTO {
  autoRotation: boolean;
  rotationIntervalSec: number;
  showLogo: boolean;
  showTournamentName: boolean;
  showFlags: boolean;
  compact: boolean;
  transparent: boolean;
  theme: 'dark' | 'light';
  overlayMode: 'auto' | 'next_matches' | 'table' | 'bracket' | 'current_match';
}

export interface OverlayOverrideDTO {
  mode: 'auto' | 'next_matches' | 'table' | 'bracket' | 'current_match';
}

export interface TournamentSummaryDTO {
  id: string;
  name: string;
  state: TournamentState;
  participantCount: number;
  createdAt: string;
  isDemo: boolean;
}

// ---- Aggregated event payload sent to clients over SSE ----

export type ServerEvent =
  | { type: 'state'; tournamentId: string; state: TournamentStateDTO }
  | { type: 'deleted'; tournamentId: string }
  | {
      type: 'ping';
      tournamentId: string;
      unitId: string;
      activationId: string;
      reason: 'manual' | 'match_activation';
      matchId: string | null;
    };

/** Returns true once per event id, allowing clients to ignore duplicate SSE deliveries. */
export function consumeActivationOnce(activationId: string, seen: Set<string>): boolean {
  if (seen.has(activationId)) return false;
  seen.add(activationId);
  return true;
}

/** Aggregated per-player view: the player's own matches, their status, and who they play next. */
export interface PlayerViewDTO {
  id: string;
  name: string;
  playerId: string; // unique unit id (e.g. p_... or t_...)
  kind: UnitKind;
  format: TournamentFormat;
  memberNames: string[]; // participant names if team, else [own name]
  groups: { id: string; name: string }[];
  nextOwnMatch: MatchDTO | null; // the match involving this player next in order
  ownMatches: MatchDTO[]; // all matches involving this player, chronological
  status: PlayerStatus;
  gamesBeforeNext: number; // how many games still before the next own match (count of earlier played/next)
}

export type PlayerStatus =
  | 'nothing_yet'
  | 'waiting'
  | 'next'
  | 'dran'
  | 'played'
  | 'eliminated';

/** Rules summary used by UI + tests. */

export const OVERLAY_VIEW_ORDER = ['next_matches', 'table', 'bracket', 'current_match'] as const;
export type OverlayView = (typeof OVERLAY_VIEW_ORDER)[number];

/** Rules summary used by UI + tests. */
export const FORMAT_RULES: Record<number, { unitKind: UnitKind; format: TournamentFormat; groups: number }> = {
  4: { unitKind: 'player', format: 'round_robin', groups: 0 },
  5: { unitKind: 'player', format: 'round_robin', groups: 0 },
  6: { unitKind: 'player', format: 'groups_of_3', groups: 2 },
  7: { unitKind: 'player', format: 'random_three', groups: 0 },
  8: { unitKind: 'team', format: 'round_robin', groups: 0 },
  9: { unitKind: 'player', format: 'random_three', groups: 0 },
  10: { unitKind: 'team', format: 'round_robin', groups: 0 },
  11: { unitKind: 'player', format: 'random_three', groups: 0 },
  12: { unitKind: 'team', format: 'groups_of_3', groups: 2 },
};

export function formatForSize(n: number): { unitKind: UnitKind; format: TournamentFormat; groups: number } {
  const rules = FORMAT_RULES[n];
  if (!rules) throw new Error(`Unsupported participant count: ${n} (must be 4-12)`);
  return rules;
}
