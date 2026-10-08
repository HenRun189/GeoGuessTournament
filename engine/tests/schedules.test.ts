// Engine tests: schedules, standings and knockout pairing for every supported size.

import { describe, expect, it } from 'vitest';
import { buildPlayerMatchLists, playerRulesReturnPath, selectOverlayRotationView } from '../../shared/src/index.js';
import {
  buildSchedule,
  buildUnits,
  computeStandings,
  formatInfo,
  generateThreeOpponentSchedule,
  roundRobinPairs,
  type UnitPlan,
} from '../src/engine.js';

function makeUnits(n: number): UnitPlan[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i + 1}`,
    kind: 'player',
    name: `U${i + 1}`,
    country: null,
    abbreviation: null,
    memberIds: [`u${i + 1}`],
  }));
}

function teamUnits(n: number): { units: UnitPlan[]; teams: { name: string; memberIds: string[] }[] } {
  const participants = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const teams: { name: string; memberIds: string[] }[] = [];
  for (let i = 0; i < n; i += 2) {
    teams.push({ name: `T${i / 2 + 1}`, memberIds: [participants[i].id, participants[i + 1].id] });
  }
  const { units } = buildUnits(participants, teams, n);
  return { units, teams };
}

describe('shared player and overlay navigation', () => {
  it('builds a unique player return route and rotates only selected views', () => {
    expect(playerRulesReturnPath('tour 1', 'team/2')).toBe('/player/tour%201/team%2F2');
    expect(selectOverlayRotationView(['all_matches', 'presentation'], 0)).toBe('all_matches');
    expect(selectOverlayRotationView(['all_matches', 'presentation'], 1)).toBe('presentation');
    expect(selectOverlayRotationView(['presentation'], 17)).toBe('presentation');
    expect(selectOverlayRotationView([], 7)).toBe('next_matches');
  });

  it('keeps completed own matches while composing upcoming and group-specific player lists', () => {
    const fixture = (id: string, a: string, b: string, status: 'waiting' | 'finished' = 'waiting') => ({ id, stage: 'PRELIMINARY' as const, round: 1, orderInStage: Number(id.slice(1)), label: id, aUnitId: a, bUnitId: b, status, result: status === 'finished' ? { winnerUnitId: a, aDamageDealt: 10, bDamageDealt: 20, aDamageTaken: 20, bDamageTaken: 10 } : null, slotA: null, slotB: null });
    const matches = [fixture('m1', 'u1', 'u2', 'finished'), fixture('m2', 'u3', 'u4'), fixture('m3', 'u1', 'u3')];
    const lists = buildPlayerMatchLists(matches, [{ id: 'g1', name: 'A', unitIds: ['u1', 'u2'] }, { id: 'g2', name: 'B', unitIds: ['u3', 'u4'] }], 'u1');
    expect(lists.ownUpcoming.map((match) => match.id)).toEqual(['m3']);
    expect(lists.ownComplete.map((match) => match.id)).toEqual(['m1', 'm3']);
    expect(lists.ownGroupUpcoming).toEqual([]);
    expect(lists.otherGroupMatches.map((match) => match.id)).toEqual(['m2']);
    expect(lists).toMatchObject({ ownGroupId: 'g1', otherGroupId: 'g2' });
  });
});

describe('formatInfo', () => {
  it('maps sizes to formats', () => {
    expect(formatInfo(4).format).toBe('round_robin');
    expect(formatInfo(6).format).toBe('groups_of_3');
    expect(formatInfo(7).format).toBe('random_three');
    expect(formatInfo(8).unitKind).toBe('team');
    expect(formatInfo(12).unitKind).toBe('team');
    expect(() => formatInfo(3)).toThrow();
    expect(() => formatInfo(13)).toThrow();
  });
});

describe('roundRobinPairs', () => {
  it('produces a full single round robin without duplicates', () => {
    for (const n of [4, 5, 6, 8, 10]) {
      const ids = makeUnits(n).map((u) => u.id);
      const pairs = roundRobinPairs(ids).map((p) => p as [string, string]);
      const expected = (n * (n - 1)) / 2;
      expect(pairs).toHaveLength(expected);
      const seen = new Set<string>();
      for (const [a, b] of pairs) {
        expect(a).not.toBe(b);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // every pair appears exactly once
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = ids[i];
          const b = ids[j];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          expect(seen.has(key)).toBe(true);
        }
      }
    }
  });
});

describe('generateThreeOpponentSchedule (7/9/11)', () => {
  for (const n of [7, 9, 11]) {
    it(`gives every one of ${n} players exactly 3 unique opponents (one bye due to parity)`, () => {
      for (let trial = 0; trial < 5; trial++) {
        const units = makeUnits(n).map((u) => u.id);
        const { pairs } = generateThreeOpponentSchedule(units);
        expect(pairs).toHaveLength((n * 3 - 1) / 2);
        const degree = new Map<string, number>(units.map((u) => [u, 0]));
        const seen = new Set<string>();
        for (const [a, b] of pairs) {
          expect(a).not.toBe(b);
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          expect(seen.has(key)).toBe(false); // no duplicate opponent
          seen.add(key);
          degree.set(a, degree.get(a)! + 1);
          degree.set(b, degree.get(b)! + 1);
        }
        // exactly one player has 2 matches (the bye), everyone else exactly 3
        const twos = [...degree.values()].filter((d) => d === 2);
        const threes = [...degree.values()].filter((d) => d === 3);
        expect(twos).toHaveLength(1);
        expect(threes).toHaveLength(n - 1);
      }
    });

    it(`is reproducible from a stored seed for ${n} players`, () => {
      const units = makeUnits(n).map((u) => u.id);
      const first = generateThreeOpponentSchedule(units, 12345);
      const second = generateThreeOpponentSchedule(units, 12345);
      expect(first.seed).toBe(second.seed);
      expect(first.pairs).toEqual(second.pairs);
    });
  }
});

describe('buildSchedule per size', () => {
  it('size 4: 6 matches, everyone plays everyone', () => {
    const schedule = buildSchedule(makeUnits(4), 4);
    expect(schedule.matches).toHaveLength(6);
    expect(schedule.knockoutPlan.sf1).toEqual({ a: { kind: 'standing', position: 1 }, b: { kind: 'standing', position: 4 } });
  });

  it('size 5: 10 matches, everyone plays everyone', () => {
    const schedule = buildSchedule(makeUnits(5), 5);
    expect(schedule.matches).toHaveLength(10);
  });

  it('size 6: two groups of 3 with 3 matches each, group-based semifinals', () => {
    const units = makeUnits(6);
    const groups = [
      { id: 'gA', name: 'Group A', unitIds: ['u1', 'u3', 'u5'] },
      { id: 'gB', name: 'Group B', unitIds: ['u2', 'u4', 'u6'] },
    ];
    const schedule = buildSchedule(units, 6, { groups });
    expect(schedule.matches).toHaveLength(6);
    expect(schedule.matches.map((match) => [match.aUnitId, match.bUnitId])).toEqual([
      ['u3', 'u5'], ['u4', 'u6'],
      ['u1', 'u5'], ['u2', 'u6'],
      ['u1', 'u3'], ['u2', 'u4'],
    ]);
    expect(schedule.matches.map((match) => match.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(schedule.knockoutPlan.sf1).toEqual({ a: { kind: 'group', groupId: 'gA', position: 1 }, b: { kind: 'group', groupId: 'gB', position: 2 } });
    expect(schedule.knockoutPlan.sf2).toEqual({ a: { kind: 'group', groupId: 'gB', position: 1 }, b: { kind: 'group', groupId: 'gA', position: 2 } });
  });

  it('size 7: 10 matches, one player with a bye (2 matches), all pairs unique', () => {
    const units = makeUnits(7).map((u) => u.id);
    const { pairs } = generateThreeOpponentSchedule(units);
    expect(pairs).toHaveLength(10);
    const degree = new Map(units.map((u) => [u, 0]));
    const seen = new Set<string>();
    for (const [a, b] of pairs) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      degree.set(a, degree.get(a)! + 1);
      degree.set(b, degree.get(b)! + 1);
    }
    const sorted = [...degree.values()].sort();
    expect(sorted).toEqual([2, 3, 3, 3, 3, 3, 3]);
  });

  it('size 8: 4 teams, 6 matches round robin', () => {
    const { units } = teamUnits(8);
    const schedule = buildSchedule(units, 8);
    expect(schedule.matches).toHaveLength(6);
    expect(schedule.knockoutPlan.sf1).toEqual({ a: { kind: 'standing', position: 1 }, b: { kind: 'standing', position: 4 } });
  });

  it('size 9: 13 matches, one bye, rest exactly 3', () => {
    const units = makeUnits(9).map((u) => u.id);
    const { pairs } = generateThreeOpponentSchedule(units);
    expect(pairs).toHaveLength(13);
    const degree = new Map(units.map((u) => [u, 0]));
    for (const [a, b] of pairs) {
      degree.set(a, degree.get(a)! + 1);
      degree.set(b, degree.get(b)! + 1);
    }
    const sorted = [...degree.values()].sort();
    expect(sorted).toEqual([2, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('size 10: 5 teams, 10 matches round robin', () => {
    const { units } = teamUnits(10);
    const schedule = buildSchedule(units, 10);
    expect(schedule.matches).toHaveLength(10);
  });

  it('size 11: 16 matches, one bye, rest exactly 3', () => {
    const units = makeUnits(11).map((u) => u.id);
    const { pairs } = generateThreeOpponentSchedule(units);
    expect(pairs).toHaveLength(16);
    const degree = new Map(units.map((u) => [u, 0]));
    for (const [a, b] of pairs) {
      degree.set(a, degree.get(a)! + 1);
      degree.set(b, degree.get(b)! + 1);
    }
    const sorted = [...degree.values()].sort();
    expect(sorted).toEqual([2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('size 12: two groups of 3 teams, 6 matches', () => {
    const { units } = teamUnits(12);
    const groups = [
      { id: 'gA', name: 'Group A', unitIds: units.slice(0, 3).map((u) => u.id) },
      { id: 'gB', name: 'Group B', unitIds: units.slice(3).map((u) => u.id) },
    ];
    const schedule = buildSchedule(units, 12, { groups });
    expect(schedule.matches).toHaveLength(6);
    expect(schedule.matches.map((match) => match.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(schedule.matches[0].aUnitId).toBe('t_2');
    expect(schedule.matches[1].aUnitId).toBe('t_5');
    expect(schedule.knockoutPlan.sf1.a).toEqual({ kind: 'group', groupId: 'gA', position: 1 });
  });
});

describe('computeStandings', () => {
  it('sorts by wins DESC, damageDealt DESC, damageTaken ASC', () => {
    const units = makeUnits(4);
    const finished = [
      { aUnitId: 'u1', bUnitId: 'u2', winnerUnitId: 'u1', aDamageDealt: 800, bDamageDealt: 700 },
      { aUnitId: 'u3', bUnitId: 'u4', winnerUnitId: 'u3', aDamageDealt: 600, bDamageDealt: 500 },
      { aUnitId: 'u1', bUnitId: 'u3', winnerUnitId: 'u3', aDamageDealt: 550, bDamageDealt: 900 },
      { aUnitId: 'u2', bUnitId: 'u4', winnerUnitId: 'u2', aDamageDealt: 640, bDamageDealt: 620 },
    ];
    const rows = computeStandings(units, finished);
    // u1: 1W, u2: 1W, u3: 2W, u4: 0W
    expect(rows[0].unitId).toBe('u3');
    expect(rows[3].unitId).toBe('u4');
    const u1 = rows.find((r) => r.unitId === 'u1')!;
    const u2 = rows.find((r) => r.unitId === 'u2')!;
    expect(u1.wins).toBe(1);
    expect(u2.wins).toBe(1);
    // tiebreak damageDealt DESC
    expect(u1.damageDealt).toBeGreaterThan(u2.damageDealt);
    expect(rows.indexOf(u1)).toBeLessThan(rows.indexOf(u2));
  });

  it('damageTaken ASC breaks a damageDealt tie', () => {
    const units = makeUnits(4);
    const finished = [
      { aUnitId: 'u1', bUnitId: 'u2', winnerUnitId: 'u1', aDamageDealt: 500, bDamageDealt: 400 },
      { aUnitId: 'u3', bUnitId: 'u4', winnerUnitId: 'u4', aDamageDealt: 300, bDamageDealt: 350 },
      { aUnitId: 'u1', bUnitId: 'u3', winnerUnitId: 'u1', aDamageDealt: 420, bDamageDealt: 380 },
      { aUnitId: 'u2', bUnitId: 'u4', winnerUnitId: 'u2', aDamageDealt: 460, bDamageDealt: 410 },
    ];
    const rows = computeStandings(units, finished);
    expect(rows[0].unitId).toBe('u1'); // 2W
    expect(rows[1].unitId).toBe('u2'); // 1W 500 dealt
    expect(rows[2].unitId).toBe('u4'); // 1W 350 dealt
    expect(rows[3].unitId).toBe('u3'); // 0W
  });

  it('sorts with the exact priorities and ignores played count and unit name', () => {
    const units = makeUnits(4);
    const finished = [
      { aUnitId: 'u1', bUnitId: 'u2', winnerUnitId: 'u1', aDamageDealt: 700, bDamageDealt: 500 },
      { aUnitId: 'u3', bUnitId: 'u4', winnerUnitId: 'u3', aDamageDealt: 700, bDamageDealt: 500 },
      { aUnitId: 'u1', bUnitId: 'u3', winnerUnitId: 'u3', aDamageDealt: 0, bDamageDealt: 200 },
      { aUnitId: 'u2', bUnitId: 'u4', winnerUnitId: 'u4', aDamageDealt: 500, bDamageDealt: 700 },
    ];
    const rows = computeStandings(units, finished);
    expect(rows.map((row) => row.unitId)).toEqual(['u3', 'u4', 'u1', 'u2']);
    expect(rows.find((row) => row.unitId === 'u1')).toMatchObject({ wins: 1, damageDealt: 700, damageTaken: 700 });
    expect(rows.find((row) => row.unitId === 'u2')).toMatchObject({ wins: 0, damageDealt: 1000, damageTaken: 1400 });
    expect(rows.find((row) => row.unitId === 'u3')).toMatchObject({ wins: 2, damageDealt: 900, damageTaken: 500 });
    expect(rows.find((row) => row.unitId === 'u4')).toMatchObject({ wins: 1, damageDealt: 1200, damageTaken: 1200 });
  });

  it('marks only teams with identical wins, damage dealt, and damage taken as tied', () => {
    const units = makeUnits(2);
    const rows = computeStandings(units, []);
    expect(rows.map((row) => row.tied)).toEqual([true, true]);
    expect(rows.map((row) => row.unitId)).toEqual(['u1', 'u2']);
  });

  it('marks exact ties', () => {
    const units = makeUnits(2);
    const finished = [
      { aUnitId: 'u1', bUnitId: 'u2', winnerUnitId: 'u1', aDamageDealt: 300, bDamageDealt: 300 },
    ];
    const rows = computeStandings(units, finished);
    // u1: 1W 300/300; u2: 0W 300/300 — not tied (wins differ)
    expect(rows[0].tied).toBe(false);
    const units3 = makeUnits(4);
    const f2 = [
      { aUnitId: 'u1', bUnitId: 'u2', winnerUnitId: 'u1', aDamageDealt: 300, bDamageDealt: 200 },
      { aUnitId: 'u3', bUnitId: 'u4', winnerUnitId: 'u3', aDamageDealt: 300, bDamageDealt: 200 },
      { aUnitId: 'u1', bUnitId: 'u3', winnerUnitId: 'u1', aDamageDealt: 100, bDamageDealt: 100 },
      { aUnitId: 'u2', bUnitId: 'u4', winnerUnitId: 'u2', aDamageDealt: 100, bDamageDealt: 100 },
    ];
    const rows2 = computeStandings(units3, f2);
    // u1: 2W; u2: 1W 300/300; u3: 1W 400/300; u4: 0W — u2 vs u3 differ in dealt; no tie expected except none
    expect(rows2.every((r) => !r.tied)).toBe(true);
  });
});

describe('buildUnits', () => {
  it('creates individual units for player formats', () => {
    const parts = Array.from({ length: 7 }, (_, i) => ({ name: `P${i + 1}` }));
    const { units } = buildUnits(parts, null, 7);
    expect(units).toHaveLength(7);
    expect(units.every((u) => u.kind === 'player')).toBe(true);
  });

  it('requires exactly n/2 teams of 2 for team formats and rejects overlaps', () => {
    const parts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    const teams = [
      { name: 'A', memberIds: ['p1', 'p2'] },
      { name: 'B', memberIds: ['p3', 'p4'] },
      { name: 'C', memberIds: ['p5', 'p6'] },
      { name: 'D', memberIds: ['p7', 'p8'] },
    ];
    const { units } = buildUnits(parts, teams, 8);
    expect(units).toHaveLength(4);
    expect(units.every((u) => u.kind === 'team')).toBe(true);
    const dup = [
      { name: 'A', memberIds: ['p1', 'p2'] },
      { name: 'B', memberIds: ['p2', 'p3'] },
      { name: 'C', memberIds: ['p5', 'p6'] },
      { name: 'D', memberIds: ['p7', 'p8'] },
    ];
    expect(() => buildUnits(parts, dup, 8)).toThrow(/multiple teams/);
    const missing = teams.slice(0, 3);
    expect(() => buildUnits(parts, missing, 8)).toThrow(/requires exactly 4/);
  });
});
