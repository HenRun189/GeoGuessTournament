// Engine-internal types. The engine works on plans; the server persists them.

import type { Stage, UnitKind, TournamentFormat } from '@gt/shared';

export interface ParticipantPlan {
  id: string;
  name: string;
  country: string | null;
  abbreviation: string | null;
}

export interface TeamPlan {
  id: string;
  name: string;
  country: string | null;
  abbreviation: string | null;
  memberIds: string[];
}

export interface UnitPlan {
  id: string;
  kind: UnitKind;
  name: string;
  country: string | null;
  abbreviation: string | null;
  memberIds: string[];
}

export interface GroupPlan {
  id: string;
  name: string;
  unitIds: string[];
}

export interface MatchPlan {
  stage: Stage;
  round: number;
  orderInStage: number;
  aUnitId: string | null; // null = decided later (slot ref)
  bUnitId: string | null;
  slotA: { kind: 'unit'; unitId: string } | { kind: 'group'; groupId: string; position: number } | { kind: 'standing'; position: number } | null;
  slotB: { kind: 'unit'; unitId: string } | { kind: 'group'; groupId: string; position: number } | { kind: 'standing'; position: number } | null;
  sfIndex?: 1 | 2; // for semifinal slots feeding the final
}

export interface SchedulePlan {
  groups: GroupPlan[];
  matches: MatchPlan[]; // preliminary matches only
  knockoutPlan: {
    sf1: { a: SlotRefPlan; b: SlotRefPlan };
    sf2: { a: SlotRefPlan; b: SlotRefPlan };
  };
  seed: number | null;
}

export type SlotRefPlan =
  | { kind: 'standing'; position: number }
  | { kind: 'group'; groupId: string; position: number };

export interface StandingRow {
  unitId: string;
  played: number;
  wins: number;
  damageDealt: number;
  damageTaken: number;
}

export interface KnockoutState {
  sf1Winner: string | null;
  sf2Winner: string | null;
  finalWinner: string | null;
}

export interface FormatInfo {
  unitKind: UnitKind;
  format: TournamentFormat;
  groups: number;
  preliminaryMatchesPerUnit: number;
}
