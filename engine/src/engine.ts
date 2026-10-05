// Pure tournament-engine logic: formats, schedules, standings, knockout.
// No I/O, no DB, no framework — deterministic given inputs (+ optional RNG seed).

import type {
  FormatInfo,
  GroupPlan,
  MatchPlan,
  SchedulePlan,
  SlotRefPlan,
  StandingRow,
  UnitPlan,
} from './types.js';
import { mulberry32 } from './rng.js';

export * from './types.js';
export { mulberry32 } from './rng.js';

const FORMATS: Record<number, FormatInfo> = {
  4: { unitKind: 'player', format: 'round_robin', groups: 0, preliminaryMatchesPerUnit: 3 },
  5: { unitKind: 'player', format: 'round_robin', groups: 0, preliminaryMatchesPerUnit: 4 },
  6: { unitKind: 'player', format: 'groups_of_3', groups: 2, preliminaryMatchesPerUnit: 2 },
  7: { unitKind: 'player', format: 'random_three', groups: 0, preliminaryMatchesPerUnit: 3 },
  8: { unitKind: 'team', format: 'round_robin', groups: 0, preliminaryMatchesPerUnit: 3 },
  9: { unitKind: 'player', format: 'random_three', groups: 0, preliminaryMatchesPerUnit: 3 },
  10: { unitKind: 'team', format: 'round_robin', groups: 0, preliminaryMatchesPerUnit: 4 },
  11: { unitKind: 'player', format: 'random_three', groups: 0, preliminaryMatchesPerUnit: 3 },
  12: { unitKind: 'team', format: 'groups_of_3', groups: 2, preliminaryMatchesPerUnit: 2 },
};

export function formatInfo(n: number): FormatInfo {
  const f = FORMATS[n];
  if (!f) throw new Error(`Unsupported participant count: ${n} (must be 4-12)`);
  return { ...f };
}

export interface CreateUnitsResult {
  participants: { id: string; name: string; country: string | null; abbreviation: string | null }[];
  units: UnitPlan[];
  teamAssignments: { unitId: string; memberIds: string[] }[];
}

function id(prefix: string, i: number): string {
  return `${prefix}_${i}`;
}

/** Build participant + unit (player or 2-player team) structures.
 * For sizes 8/10/12 the caller must provide teams pairing 2 participants each. */
export function buildUnits(
  participants: { name: string; country?: string | null; abbreviation?: string | null; id?: string }[],
  teams: { name: string; country?: string | null; abbreviation?: string | null; memberIds: string[]; id?: string }[] | null,
  size: number,
): CreateUnitsResult {
  const info = formatInfo(size);
  const parts = participants.map((p, i) => ({
    id: p.id ?? id('p', i + 1),
    name: p.name,
    country: p.country ?? null,
    abbreviation: p.abbreviation ?? null,
  }));
  if (parts.length !== size) {
    throw new Error(`Expected ${size} participants, got ${parts.length}`);
  }

  const units: UnitPlan[] = [];
  const teamAssignments: { unitId: string; memberIds: string[] }[] = [];

  if (info.unitKind === 'player') {
    if (teams && teams.length > 0) {
      throw new Error(`Tournament of ${size} participants uses individual players; teams are not allowed.`);
    }
    for (const p of parts) {
      units.push({ id: p.id, kind: 'player', name: p.name, country: p.country, abbreviation: p.abbreviation, memberIds: [p.id] });
    }
  } else {
    if (!teams || teams.length !== size / 2) {
      throw new Error(`Tournament of ${size} participants requires exactly ${size / 2} two-player teams.`);
    }
    const memberToUnit = new Map<string, string>();
    teams.forEach((t, i) => {
      if (!t.memberIds || t.memberIds.length !== 2) {
        throw new Error(`Team "${t.name}" must have exactly 2 members.`);
      }
      const unitId = t.id ?? id('t', i + 1);
      for (const m of t.memberIds) {
        if (memberToUnit.has(m)) throw new Error(`Participant ${m} assigned to multiple teams.`);
        memberToUnit.set(m, unitId);
      }
      units.push({
        id: unitId,
        kind: 'team',
        name: t.name,
        country: t.country ?? null,
        abbreviation: t.abbreviation ?? null,
        memberIds: t.memberIds,
      });
      teamAssignments.push({ unitId, memberIds: t.memberIds });
    });
    for (const p of parts) {
      if (!memberToUnit.has(p.id)) throw new Error(`Participant ${p.name} is not assigned to any team.`);
    }
  }

  return { participants: parts, units, teamAssignments };
}

/** Round-robin circle method. Returns pairs of unit ids; bye with null if odd count. */
export function roundRobinPairs(unitIds: string[]): [string | null, string | null][] {
  const ids = [...unitIds];
  if (ids.length % 2 === 1) ids.push(null as unknown as string);
  const n = ids.length;
  const rounds: [string | null, string | null][] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a !== null && b !== null) rounds.push([a, b]);
    }
    // rotate: keep first fixed
    const fixed = ids[0];
    const rest = ids.slice(1);
    rest.unshift(rest.pop() as string);
    ids.splice(0, ids.length, fixed, ...rest);
  }
  return rounds;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Random 3-opponent schedule for 7/9/11 players.
 *
 * NOTE (mathematical constraint): n players with exactly 3 matches each sums to n*3
 * appearances, which must be even. For n = 7/9/11 that is 21/27/33 — always odd, so a
 * perfect 3-matches-per-player schedule cannot exist. The spec's other hard rule
 * ("no player plays the same opponent twice") is kept, so exactly ONE player receives
 * a bye (2 matches) and everyone else plays exactly 3. Matches: 10/13/16.
 * See README "Assumptions".
 */
export function generateThreeOpponentSchedule(unitIds: string[], seed?: number): { pairs: [string, string][]; seed: number } {
  const n = unitIds.length;
  if (n !== 7 && n !== 9 && n !== 11) {
    throw new Error(`random_three format only supports 7, 9 or 11 players, got ${n}`);
  }
  const targetMatches = (n * 3 - 1) / 2; // 10 / 13 / 16
  const attempts = 800;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const s = seed ?? Math.floor(Math.random() * 2 ** 31);
    const rand = mulberry32(s + attempt * 7919);
    const byePlayer = unitIds[Math.floor(rand() * n)];
    const targets = new Map<string, number>(unitIds.map((u) => [u, u === byePlayer ? 2 : 3]));
    const degree = new Map<string, number>(unitIds.map((u) => [u, 0]));
    const pairsSet = new Set<string>();
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    let ok = true;

    while (pairsSet.size < targetMatches) {
      const candidates = shuffle(
        unitIds.filter((u) => degree.get(u)! < targets.get(u)!),
        rand,
      );
      candidates.sort((a, b) => degree.get(a)! - degree.get(b)!);
      const paired = new Set<string>();
      for (let i = 0; i < candidates.length; i++) {
        const a = candidates[i];
        if (paired.has(a)) continue;
        let best: string | null = null;
        for (let j = i + 1; j < candidates.length; j++) {
          const b = candidates[j];
          if (paired.has(b)) continue;
          if (pairsSet.has(key(a, b))) continue;
          if (best === null || degree.get(b)! < degree.get(best)!) best = b;
        }
        if (best !== null) {
          pairsSet.add(key(a, best));
          degree.set(a, degree.get(a)! + 1);
          degree.set(best, degree.get(best)! + 1);
          paired.add(a);
          paired.add(best);
        }
      }
      if (paired.size === 0) {
        ok = false;
        break;
      }
    }

    const valid =
      ok &&
      [...degree.entries()].every(([u, d]) => (u === byePlayer ? d === 2 : d === 3)) &&
      pairsSet.size === targetMatches;

    if (valid) {
      const pairs = [...pairsSet].map((k) => k.split('|') as [string, string]);
      // Final validation pass
      const deg = new Map<string, number>(unitIds.map((u) => [u, 0]));
      for (const [a, b] of pairs) {
        if (a === b) throw new Error('Self-match generated');
        deg.set(a, deg.get(a)! + 1);
        deg.set(b, deg.get(b)! + 1);
      }
      for (const u of unitIds) {
        const expected = u === byePlayer ? 2 : 3;
        if (deg.get(u) !== expected) throw new Error(`Validation failed: ${u} has ${deg.get(u)} matches (expected ${expected})`);
      }
      return { pairs, seed: s + attempt * 7919 };
    }
  }
  throw new Error('Failed to generate a valid 3-opponent schedule after 800 attempts');
}

/** Build the full preliminary schedule for a tournament size. */
export function buildSchedule(
  units: UnitPlan[],
  size: number,
  opts?: { seed?: number; groups?: GroupPlan[]; rng?: () => number },
): SchedulePlan {
  const info = formatInfo(size);
  const unitIds = units.map((u) => u.id);
  const prelimMatches: MatchPlan[] = [];
  let seed: number | null = null;
  let groups: GroupPlan[] = opts?.groups ?? [];

  if (info.format === 'round_robin') {
    const pairs = roundRobinPairs(unitIds);
    pairs.forEach(([a, b], i) => {
      prelimMatches.push({
        stage: 'PRELIMINARY',
        round: Math.floor(i / Math.floor(units.length / 2)) + 1,
        orderInStage: i + 1,
        aUnitId: a,
        bUnitId: b,
        slotA: { kind: 'unit', unitId: a as string },
        slotB: { kind: 'unit', unitId: b as string },
      });
    });
  } else if (info.format === 'groups_of_3') {
    if (groups.length !== 2) throw new Error('groups_of_3 requires exactly 2 groups');
    groups = groups.map((g) => ({ ...g }));
    // Build round-robin pairs per group, then interleave the rounds across both
    // groups so that Group A and Group B play on the same round (alternating),
    // instead of finishing one group entirely before the other.
    const pairLists = groups.map((g) => roundRobinPairs(g.unitIds));
    const totalRounds = Math.max(...pairLists.map((list) => list.length));
    for (let r = 0; r < totalRounds; r++) {
      for (let gi = 0; gi < groups.length; gi++) {
        const pairs = pairLists[gi];
        if (r < pairs.length) {
          const [a, b] = pairs[r];
          if (a != null && b != null) {
            prelimMatches.push({
              stage: 'PRELIMINARY',
              round: r + 1,
              orderInStage: prelimMatches.length + 1,
              aUnitId: a,
              bUnitId: b,
              slotA: { kind: 'unit', unitId: a as string },
              slotB: { kind: 'unit', unitId: b as string },
            });
          }
        }
      }
    }
  } else {
    // random_three
    const { pairs, seed: s } = generateThreeOpponentSchedule(unitIds, opts?.seed);
    seed = s;
    const shuffled = opts?.rng ? shuffle(pairs, opts.rng) : pairs;
    shuffled.forEach(([a, b], i) => {
      prelimMatches.push({
        stage: 'PRELIMINARY',
        round: Math.floor(i / Math.ceil(pairs.length / 3)) + 1,
        orderInStage: i + 1,
        aUnitId: a,
        bUnitId: b,
        slotA: { kind: 'unit', unitId: a },
        slotB: { kind: 'unit', unitId: b },
      });
    });
  }

  const knockoutPlan: SchedulePlan['knockoutPlan'] = info.format === 'groups_of_3'
    ? {
        sf1: { a: { kind: 'group', groupId: groups[0].id, position: 1 }, b: { kind: 'group', groupId: groups[1].id, position: 2 } },
        sf2: { a: { kind: 'group', groupId: groups[1].id, position: 1 }, b: { kind: 'group', groupId: groups[0].id, position: 2 } },
      }
    : {
        sf1: { a: { kind: 'standing', position: 1 }, b: { kind: 'standing', position: 4 } },
        sf2: { a: { kind: 'standing', position: 2 }, b: { kind: 'standing', position: 3 } },
      };

  return { groups, matches: prelimMatches, knockoutPlan, seed };
}

export interface ResultLike {
  aUnitId: string;
  bUnitId: string;
  winnerUnitId: string;
  aDamageDealt: number;
  bDamageDealt: number;
}

/** Compute standings from finished matches. Ties: identical W, dmg+, dmg- => same position. */
export function computeStandings(
  units: UnitPlan[],
  matches: { aUnitId: string; bUnitId: string; winnerUnitId: string | null; aDamageDealt: number; bDamageDealt: number }[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    units.map((u) => [u.id, { unitId: u.id, played: 0, wins: 0, damageDealt: 0, damageTaken: 0 }]),
  );
  for (const m of matches) {
    if (m.winnerUnitId === null) continue;
    const a = rows.get(m.aUnitId);
    const b = rows.get(m.bUnitId);
    if (!a || !b) throw new Error(`Match references unknown unit: ${m.aUnitId} vs ${m.bUnitId}`);
    a.played += 1;
    b.played += 1;
    a.damageDealt += m.aDamageDealt;
    b.damageDealt += m.bDamageDealt;
    a.damageTaken += m.bDamageDealt;
    b.damageTaken += m.aDamageDealt;
    if (m.winnerUnitId === m.aUnitId) a.wins += 1;
    else if (m.winnerUnitId === m.bUnitId) b.wins += 1;
  }
  const list = [...rows.values()];
  list.sort((x, y) => y.wins - x.wins || y.damageDealt - x.damageDealt || x.damageTaken - y.damageTaken);
  // mark ties
  const out: (StandingRow & { tied: boolean })[] = list.map((r) => ({ ...r, tied: false }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      if (a.wins === b.wins && a.damageDealt === b.damageDealt && a.damageTaken === b.damageTaken) {
        a.tied = true;
        b.tied = true;
      } else break; // sorted, so once different we can stop scanning this run
    }
  }
  return out as StandingRow[];
}

export type ResolvedSlot =
  | { ok: true; unitId: string }
  | { ok: false; reason: string };

/** Resolve a knockout slot against current standings/groups. */
export function resolveSlot(
  slot: { kind: 'standing'; position: number } | { kind: 'group'; groupId: string; position: number },
  standings: StandingRow[],
  groupStandings: Record<string, StandingRow[]>,
): ResolvedSlot {
  if (slot.kind === 'standing') {
    const row = standings[slot.position - 1];
    if (!row) return { ok: false, reason: `No team at position ${slot.position}` };
    return { ok: true, unitId: row.unitId };
  }
  const rows = groupStandings[slot.groupId];
  const row = rows?.[slot.position - 1];
  if (!row) return { ok: false, reason: `No team at position ${slot.position} in group ${slot.groupId}` };
  return { ok: true, unitId: row.unitId };
}
