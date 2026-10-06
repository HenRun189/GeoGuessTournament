// End-to-end tests over the real service + SQLite: create → results → knockout → undo.

import { afterAll, describe, expect, it } from 'vitest';
import type { TournamentStateDTO } from '@gt/shared';
import { prisma } from '../src/services/db.js';
import { createTournament, saveResult, editResult, undoLastResult, setTournamentState, resetTournament, setCurrentMatch, sendManualPing, setReadiness, reportProblem, resolveProblem, uploadParticipantImage, removeParticipantImage, updatePresentationDecks, selectPresentationDeck, navigatePresentation, setPresentationActive, uploadPresentationVideo,  setPresentationVideoActive, deleteTournament } from '../src/services/mutations.js';
import { addClient, broadcast } from '../src/services/db.js';
import { consumeActivationOnce } from '@gt/shared';
import { getTournamentState } from '../src/services/state.js';

async function playAllPreliminaries(id: string): Promise<TournamentStateDTO> {
  await setTournamentState(id, 'PRELIMINARY');
  for (let guard = 0; guard < 50; guard++) {
    const state = await getTournamentState(id);
    if (state.state !== 'PRELIMINARY') return state;
    const next = state.matches.find((m) => m.stage === 'PRELIMINARY' && m.status === 'waiting');
    if (!next) return state;
    const a = 300 + Math.floor(Math.random() * 600);
    const b = 300 + Math.floor(Math.random() * 600);
    await saveResult(id, next.id, {
      winnerUnitId: a >= b ? next.aUnitId! : next.bUnitId!,
      aDamageDealt: a,
      bDamageDealt: b,
    });
  }
  return getTournamentState(id);
}

async function playAll(id: string): Promise<TournamentStateDTO> {
  let last = await playAllPreliminaries(id);
  for (let guard = 0; guard < 10; guard++) {
    if (last.state === 'FINISHED') return last;
    const next = last.matches.find((m) => m.status === 'waiting' && m.aUnitId && m.bUnitId);
    if (!next) {
      try {
        await setTournamentState(id, last.state === 'SEMIFINALS' ? 'FINAL' : 'FINISHED');
      } catch {
        break;
      }
      last = await getTournamentState(id);
      continue;
    }
    const a = 300 + Math.floor(Math.random() * 600);
    const b = 300 + Math.floor(Math.random() * 600);
    await saveResult(id, next.id, {
      winnerUnitId: a >= b ? next.aUnitId! : next.bUnitId!,
      aDamageDealt: a,
      bDamageDealt: b,
    });
    last = await getTournamentState(id);
  }
  return getTournamentState(id);
}

function individualParticipants(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Player${i + 1}` }));
}

function teamSetup(n: number) {
  const participants = Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, id: `p${i + 1}` }));
  const teams = [];
  for (let i = 0; i < n; i += 2) {
    teams.push({ name: `Team ${i / 2 + 1}`, memberIds: [`p${i + 1}`, `p${i + 2}`] });
  }
  return { participants, teams };
}

describe('tournament lifecycle across all sizes', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const id of created) {
      try { await deleteTournament(id); } catch { /* test-only placeholder or already removed */ }
    }
    await prisma.$disconnect();
  });

  const cases: { size: number; team: boolean }[] = [
    { size: 4, team: false },
    { size: 5, team: false },
    { size: 6, team: false },
    { size: 7, team: false },
    { size: 8, team: true },
    { size: 9, team: false },
    { size: 10, team: true },
    { size: 11, team: false },
    { size: 12, team: true },
  ];

  for (const { size, team } of cases) {
    it(`size ${size}: create → preliminary → semifinals → final → finished`, async () => {
      let args: Parameters<typeof createTournament>[0];
      if (team) {
        const { participants, teams } = teamSetup(size);
        args = { name: `T${size}`, participantCount: size, participants, teams };
      } else {
        args = { name: `T${size}`, participantCount: size, participants: individualParticipants(size) };
      }
      const id = await createTournament(args);
      created.push(id);

      let state = await getTournamentState(id);

      // structure checks
      if (size === 6 || size === 12) {
        expect(state.groups).toHaveLength(2);
        expect(state.groups[0].unitIds).toHaveLength(size / 2 === 6 ? 3 : 3);
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(6);
      } else if (size === 4) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(6);
      } else if (size === 5) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(10);
      } else if (size === 7) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(10);
      } else if (size === 8) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(6);
        expect(state.units).toHaveLength(4);
        expect(state.units.every((u) => u.kind === 'team' && u.members.length === 2)).toBe(true);
      } else if (size === 9) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(13);
      } else if (size === 10) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(10);
      } else if (size === 11) {
        expect(state.matches.filter((m) => m.stage === 'PRELIMINARY')).toHaveLength(16);
      }

      // 7/9/11: no duplicate opponents
      if (size === 7 || size === 9 || size === 11) {
        const seen = new Set<string>();
        for (const m of state.matches.filter((m) => m.stage === 'PRELIMINARY')) {
          const key = [m.aUnitId!, m.bUnitId!].sort().join('|');
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }

      state = await playAll(id);
      expect(state.state).toBe('FINISHED');
      expect(state.knockout?.sf1).not.toBeNull();
      expect(state.knockout?.sf2).not.toBeNull();
      expect(state.knockout?.final).not.toBeNull();
      expect(state.knockout?.championUnitId).not.toBeNull();

      // semifinal pairings: 1v4/2v3 (or group cross for 6/12)
      if (size !== 6 && size !== 12) {
        const sfA = state.knockout!.sf1!.aUnitId!;
        const sfB = state.knockout!.sf1!.bUnitId!;
        const sfC = state.knockout!.sf2!.aUnitId!;
        const sfD = state.knockout!.sf2!.bUnitId!;
        const top4 = state.standings.slice(0, 4).map((r) => r.unitId);
        expect(new Set([sfA, sfB, sfC, sfD])).toEqual(new Set(top4));
      }

      // eliminations
      const expectedEliminated = size === 4 ? 0 : size === 5 ? 1 : size === 6 ? 2 : size === 7 ? 3 : size === 8 ? 0 : size === 9 ? 4 : size === 10 ? 1 : size === 11 ? 6 : 2;
      expect(state.knockout!.eliminatedUnitIds.length).toBeGreaterThanOrEqual(expectedEliminated - 1);
      expect(state.knockout!.eliminatedUnitIds.length).toBeLessThanOrEqual(expectedEliminated + 1);
    }, 60000);
  }

  it('rejects invalid results', async () => {
    const id = await createTournament({ name: 'Err', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const state = await getTournamentState(id);
    const m = state.matches.find((x) => x.stage === 'PRELIMINARY')!;

    await expect(
      saveResult(id, m.id, { winnerUnitId: 'nonexistent', aDamageDealt: 1, bDamageDealt: 1 }),
    ).rejects.toThrow(/winner/i);
    await expect(
      saveResult(id, m.id, { winnerUnitId: m.aUnitId!, aDamageDealt: -5, bDamageDealt: 1 }),
    ).rejects.toThrow(/damage/i);
    await expect(
      saveResult(id, m.id, { winnerUnitId: m.aUnitId!, aDamageDealt: 1.5, bDamageDealt: 1 }),
    ).rejects.toThrow(/whole/i);

    // double save protection
    await saveResult(id, m.id, { winnerUnitId: m.aUnitId!, aDamageDealt: 100, bDamageDealt: 50 });
    await expect(
      saveResult(id, m.id, { winnerUnitId: m.aUnitId!, aDamageDealt: 100, bDamageDealt: 50 }),
    ).rejects.toThrow(/undo/i);
  });

  it('undo restores previous match state', async () => {
    const id = await createTournament({ name: 'Undo', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const state = await getTournamentState(id);
    const m1 = state.matches.filter((x) => x.stage === 'PRELIMINARY')[0];
    const m2 = state.matches.filter((x) => x.stage === 'PRELIMINARY')[1];

    await saveResult(id, m1.id, { winnerUnitId: m1.aUnitId!, aDamageDealt: 800, bDamageDealt: 700 });
    let s = await getTournamentState(id);
    expect(s.matches.find((x) => x.id === m1.id)!.status).toBe('finished');
    const winsAfter = s.standings.find((r) => r.unitId === m1.aUnitId)!.wins;

    await saveResult(id, m2.id, { winnerUnitId: m2.aUnitId!, aDamageDealt: 500, bDamageDealt: 400 });
    s = await getTournamentState(id);

    await undoLastResult(id);
    s = await getTournamentState(id);
    expect(s.matches.find((x) => x.id === m2.id)!.status).toBe('waiting');
    expect(s.matches.find((x) => x.id === m2.id)!.result).toBeNull();
    expect(s.matches.find((x) => x.id === m1.id)!.status).toBe('finished');
    expect(s.standings.find((r) => r.unitId === m1.aUnitId)!.wins).toBe(winsAfter);
  });

  it('state and player APIs use the interleaved engine schedule for groups', async () => {
    const id = await createTournament({ name: 'Groups order', participantCount: 6, participants: individualParticipants(6) });
    created.push(id);
    const state = await getTournamentState(id);
    const preliminaries = state.matches.filter((match) => match.stage === 'PRELIMINARY');
    expect(preliminaries.map((match) => match.round)).toEqual([1, 1, 2, 2, 3, 3]);
    const player = state.playerViews[state.groups[0].unitIds[0]];
    expect(player.groups).toEqual([{ id: state.groups[0].id, name: state.groups[0].name }]);
    const serializedState = JSON.parse(JSON.stringify(state)) as { playerViews: Record<string, unknown> };
    expect(Object.keys(serializedState.playerViews)).toContain(player.playerId);

  });

  it('manual ping broadcasts a unique notification without changing tournament state', async () => {
    const id = await createTournament({ name: 'Manual ping', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    const before = await getTournamentState(id);
    const unitId = before.units[0].id;
    const events: { type?: string; unitId?: string; reason?: string; activationId?: string; matchId?: string | null }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await sendManualPing(id, unitId);
      const after = await getTournamentState(id);
      expect(after.matches).toEqual(before.matches);
      expect(after.currentMatchId).toBe(before.currentMatchId);
      const ping = events.find((event) => event.type === 'ping');
      expect(ping).toMatchObject({ type: 'ping', unitId, reason: 'manual', matchId: null });
      expect(ping?.activationId).toEqual(expect.any(String));
      expect(ping?.activationId).not.toContain('unknown');
      broadcast(id, { type: 'ping', tournamentId: id, unitId, activationId: ping!.activationId, reason: 'manual', matchId: null });
      const pingFrames = events.filter((event) => event.type === 'ping');
      expect(pingFrames).toHaveLength(2);
      expect(new Set(pingFrames.map((event) => event.activationId)).size).toBe(1);
      const seen = new Set<string>();
      expect(consumeActivationOnce(ping!.activationId!, seen)).toBe(true);
      expect(consumeActivationOnce(ping!.activationId!, seen)).toBe(false);
      await expect(sendManualPing(id, 'unknown-unit')).rejects.toThrow(/not found/i);
    } finally {
      remove();
    }
  });

  it('activates and pings only the selected match units, then promotes the next scheduled match', async () => {
    const id = await createTournament({ name: 'Auto advance', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const initial = await getTournamentState(id);
    const first = initial.matches.find((match) => match.stage === 'PRELIMINARY')!;
    const expectedNext = initial.matches.find((match) => match.stage === 'PRELIMINARY' && match.orderInStage > first.orderInStage)!;
    const events: { type?: string; unitId?: string; matchId?: string | null; reason?: string; activationId?: string }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await setCurrentMatch(id, first.id);
      const activationPings = events.filter((event) => event.type === 'ping' && event.reason === 'match_activation');
      const activationUnits = new Set(activationPings.map((event) => event.unitId));
      expect(activationUnits).toEqual(new Set([first.aUnitId, first.bUnitId]));
      expect(activationPings.every((event) => event.matchId === first.id)).toBe(true);
      const untouched = initial.units.find((unit) => unit.id !== first.aUnitId && unit.id !== first.bUnitId)!;
      expect(activationPings.some((event) => event.unitId === untouched.id)).toBe(false);

      await saveResult(id, first.id, { winnerUnitId: first.aUnitId!, aDamageDealt: 600, bDamageDealt: 400 });
      const after = await getTournamentState(id);
      expect(after.matches.find((match) => match.id === first.id)?.status).toBe('finished');
      expect(after.currentMatchId).toBe(expectedNext.id);
      expect(after.matches.find((match) => match.id === expectedNext.id)?.status).toBe('live');
      const activePlayer = after.playerViews[expectedNext.aUnitId!];
      expect(activePlayer.status).toBe('dran');
      expect(activePlayer.nextOwnMatch?.id).toBe(expectedNext.id);
      expect(events.some((event) => event.type === 'state')).toBe(true);
      expect(new Set(events.filter((event) => event.type === 'ping' && event.matchId === expectedNext.id).map((event) => event.unitId))).toEqual(new Set([expectedNext.aUnitId, expectedNext.bUnitId]));
    } finally {
      remove();
    }
  });

  it('readiness is match-scoped, live, and does not alter tournament state', async () => {
    const id = await createTournament({ name: 'Readiness', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const before = await getTournamentState(id);
    const match = before.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    await setCurrentMatch(id, match.id);
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      const beforeReady = await getTournamentState(id);
      await setReadiness(id, match.aUnitId!, 'ready');
      let state = await getTournamentState(id);
      expect(state.state).toBe(beforeReady.state);
      expect(state.currentMatchId).toBe(match.id);
      expect(state.matches).toEqual(beforeReady.matches);
      expect(state.units.find((unit) => unit.id === match.aUnitId)?.readiness).toBe('ready');
      await setReadiness(id, match.aUnitId!, 'in_game');
      state = await getTournamentState(id);
      expect(state.units.find((unit) => unit.id === match.aUnitId)?.readiness).toBe('in_game');
      expect(events.some((event) => event.type === 'state' && event.state?.units.find((unit) => unit.id === match.aUnitId)?.readiness === 'in_game')).toBe(true);
      await setReadiness(id, match.aUnitId!, 'waiting');
      state = await getTournamentState(id);
      expect(state.units.find((unit) => unit.id === match.aUnitId)?.readiness).toBe('waiting');
      expect(state.units.find((unit) => unit.id === match.aUnitId)?.readinessMatchId).toBeNull();
      expect(state.matches).toEqual(beforeReady.matches);
      await saveResult(id, match.id, { winnerUnitId: match.aUnitId!, aDamageDealt: 500, bDamageDealt: 400 });
      state = await getTournamentState(id);
      expect(state.units.find((unit) => unit.id === match.aUnitId)?.readiness).toBe('waiting');
    } finally { remove(); }
    await expect(setReadiness(id, 'missing-unit', 'ready')).rejects.toThrow(/not found/i);
  });

  it('admin presentation decks are configurable, navigate live, and never change tournament progression', async () => {
    const id = await createTournament({ name: 'Presentation controls', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const initial = await getTournamentState(id);
    const match = initial.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    await setCurrentMatch(id, match.id);
    const before = await getTournamentState(id);
    const decks = [
      { id: 'welcome', title: 'Auftakt', slides: [
        { id: 'first', title: 'Willkommen', text: 'Start', imageUrl: null },
        { id: 'second', title: 'Regeln', text: 'Spielt fair.', imageUrl: null },
        { id: 'third', title: 'Los geht’s', text: 'Viel Erfolg!', imageUrl: null },
      ] },
      { id: 'finals', title: 'Finale', slides: [{ id: 'final', title: 'Finale', text: 'Das Endspiel.', imageUrl: null }] },
    ];
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await updatePresentationDecks(id, decks);
      let state = await getTournamentState(id);
      expect(state.presentation.decks).toEqual(decks);
      expect(state.presentation.active).toBe(false);
      expect(state.currentMatchId).toBe(before.currentMatchId);
      expect(state.state).toBe(before.state);
      expect(state.matches).toEqual(before.matches);

      await selectPresentationDeck(id, 'welcome');
      await setPresentationActive(id, true);
      await navigatePresentation(id, 1);
      state = await getTournamentState(id);
      expect(state.presentation).toMatchObject({ active: true, activeDeckId: 'welcome', currentIndex: 1 });
      expect(state.state).toBe(before.state);
      expect(state.currentMatchId).toBe(before.currentMatchId);
      expect(state.matches).toEqual(before.matches);
      await navigatePresentation(id, 1);
      await navigatePresentation(id, 1);
      expect((await getTournamentState(id)).presentation.currentIndex).toBe(2);
      await navigatePresentation(id, -1);
      expect((await getTournamentState(id)).presentation.currentIndex).toBe(1);
      await selectPresentationDeck(id, 'finals');
      state = await getTournamentState(id);
      expect(state.presentation).toMatchObject({ active: false, activeDeckId: 'finals', currentIndex: 0 });
      expect(events.some((event) => event.type === 'state' && event.state?.presentation.active && event.state.presentation.currentIndex === 1)).toBe(true);
      await setPresentationActive(id, true);
      await setPresentationActive(id, false);
      expect((await getTournamentState(id)).presentation.active).toBe(false);
      await expect(updatePresentationDecks(id, [decks[0], decks[0]])).rejects.toThrow(/eindeutig/);
      await expect(navigatePresentation(id, 1)).rejects.toThrow(/nicht aktiv/);
    } finally { remove(); }
  });

  it('uploads and toggles a bounded shared MP4 without changing presentation or tournament progression', async () => {
    const id = await createTournament({ name: 'Shared video', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const initial = await getTournamentState(id);
    const match = initial.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    await setCurrentMatch(id, match.id);
    const beforePlayback = await getTournamentState(id);
    const slides = beforePlayback.presentation.decks;
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      const mp4 = Buffer.alloc(32);
      mp4.write('ftyp', 4, 'ascii');
      await uploadPresentationVideo(id, mp4);
      let state = await getTournamentState(id);
      expect(state.presentationVideo?.active).toBe(false);
      expect(state.presentationVideo?.url.startsWith('/api/uploads/presentation_')).toBe(true);
      expect(state.presentationVideo?.url.endsWith('.mp4')).toBe(true);
      expect(state.presentation.decks).toEqual(slides);
      await expect(uploadPresentationVideo(id, Buffer.from('not an mp4'))).rejects.toThrow(/MP4/);
      await setPresentationVideoActive(id, true);
      state = await getTournamentState(id);
      expect(state.presentationVideo?.active).toBe(true);
      expect(state.currentMatchId).toBe(match.id);
      expect(state.matches).toEqual(beforePlayback.matches);
      expect(events.some((event) => event.type === 'state' && event.state?.presentationVideo?.active)).toBe(true);
      await setPresentationVideoActive(id, false);
      expect((await getTournamentState(id)).presentationVideo?.active).toBe(false);
      await expect(setPresentationVideoActive('missing', true)).rejects.toThrow(/not found/i);
    } finally { remove(); }
  });

  it('automatically publishes a timed result screen after saving a result', async () => {
    const id = await createTournament({ name: 'Result screen', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const before = await getTournamentState(id);
    const match = before.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await saveResult(id, match.id, { winnerUnitId: match.aUnitId!, aDamageDealt: 720, bDamageDealt: 410 });
      const state = await getTournamentState(id);
      expect(state.matches.find((candidate) => candidate.id === match.id)?.result).toMatchObject({ winnerUnitId: match.aUnitId, aDamageDealt: 720, bDamageDealt: 410 });
      expect(state.resultScreen?.matchId).toBe(match.id);
      expect(Date.parse(state.resultScreen!.until)).toBeGreaterThan(Date.now());
      expect(events.some((event) => event.type === 'state' && event.state?.resultScreen?.matchId === match.id)).toBe(true);
      await prisma.tournament.update({ where: { id }, data: { resultScreenUntil: new Date(Date.now() - 1000) } });
      expect((await getTournamentState(id)).resultScreen).toBeNull();
    } finally { remove(); }
  });

  it('problem reports are bounded, live, and can be resolved by the admin', async () => {
    const id = await createTournament({ name: 'Help', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const state = await getTournamentState(id);
    const unitId = state.units[0].id;
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await reportProblem(id, unitId, ' Ich kann das GeoGuessr-Spiel nicht öffnen. ');
      let current = await getTournamentState(id);
      expect(current.units.find((unit) => unit.id === unitId)?.problemReport).toMatchObject({ message: 'Ich kann das GeoGuessr-Spiel nicht öffnen.', resolved: false });
      expect(events.some((event) => event.type === 'state' && event.state?.units.find((unit) => unit.id === unitId)?.problemReport?.message.includes('nicht öffnen'))).toBe(true);
      await resolveProblem(id, unitId);
      current = await getTournamentState(id);
      expect(current.units.find((unit) => unit.id === unitId)?.problemReport?.resolved).toBe(true);
      await expect(reportProblem(id, unitId, 'x'.repeat(301))).rejects.toThrow(/300 Zeichen/);
    } finally { remove(); }
  });

  it('correcting a preliminary result rebuilds knockouts and recalculates the rankings', async () => {
    const id = await createTournament({ name: 'Edit prelim', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    let state = await playAll(id);
    const match = state.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    const originalWinner = match.result!.winnerUnitId;
    const correctedWinner = originalWinner === match.aUnitId ? match.bUnitId! : match.aUnitId!;
    const events: { type?: string; state?: TournamentStateDTO }[] = [];
    const remove = addClient(id, (chunk) => {
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (data) events.push(JSON.parse(data) as typeof events[number]);
    });
    try {
      await editResult(id, match.id, { winnerUnitId: correctedWinner, aDamageDealt: 900, bDamageDealt: 100 });
      state = await getTournamentState(id);
      expect(state.state).toBe('SEMIFINALS');
      expect(state.matches.find((candidate) => candidate.id === match.id)?.result?.winnerUnitId).toBe(correctedWinner);
      expect(state.matches.filter((candidate) => candidate.stage === 'SEMIFINALS')).toHaveLength(2);
      expect(state.matches.filter((candidate) => candidate.stage === 'SEMIFINALS').every((candidate) => candidate.result === null)).toBe(true);
      expect(state.matches.some((candidate) => candidate.stage === 'FINAL')).toBe(false);
      expect(events.some((event) => event.type === 'state' && event.state?.matches.find((candidate) => candidate.id === match.id)?.result?.winnerUnitId === correctedWinner)).toBe(true);
    } finally { remove(); }
  });

  it('correcting semifinals rebuilds final, and correcting a finished final changes the champion', async () => {
    const id = await createTournament({ name: 'Edit knockout', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    let state = await playAll(id);
    const semifinal = state.matches.find((candidate) => candidate.stage === 'SEMIFINALS')!;
    const sfWinner = semifinal.result!.winnerUnitId === semifinal.aUnitId ? semifinal.bUnitId! : semifinal.aUnitId!;
    await editResult(id, semifinal.id, { winnerUnitId: sfWinner, aDamageDealt: 777, bDamageDealt: 333 });
    state = await getTournamentState(id);
    expect(state.state).toBe('FINAL');
    const final = state.matches.find((candidate) => candidate.stage === 'FINAL')!;
    expect(final.result).toBeNull();
    expect(final.aUnitId).toBe(state.matches.find((candidate) => candidate.id === semifinal.id)?.result?.winnerUnitId);

    const finalWinner = final.result?.winnerUnitId ?? final.aUnitId!;
    const correctedFinalWinner = finalWinner === final.aUnitId ? final.bUnitId! : final.aUnitId!;
    await saveResult(id, final.id, { winnerUnitId: finalWinner, aDamageDealt: 600, bDamageDealt: 500 });
    state = await getTournamentState(id);
    expect(state.state).toBe('FINISHED');
    await editResult(id, final.id, { winnerUnitId: correctedFinalWinner, aDamageDealt: 200, bDamageDealt: 850 });
    state = await getTournamentState(id);
    expect(state.state).toBe('FINISHED');
    expect(state.knockout?.championUnitId).toBe(correctedFinalWinner);
  });

  it('manual activation selects any valid upcoming match and rejects unresolved matches', async () => {
    const id = await createTournament({ name: 'Manual activation', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    let state = await getTournamentState(id);
    const first = state.matches.find((match) => match.stage === 'PRELIMINARY')!;
    await setCurrentMatch(id, first.id);
    state = await getTournamentState(id);
    const later = [...state.matches].reverse().find((match) => match.stage === 'PRELIMINARY' && match.status === 'waiting')!;
    await setCurrentMatch(id, later.id);
    state = await getTournamentState(id);
    expect(state.currentMatchId).toBe(later.id);
    expect(state.matches.find((match) => match.id === first.id)?.status).toBe('waiting');
    expect(state.matches.find((match) => match.id === later.id)?.status).toBe('live');
    const knockoutOnly = await createTournament({ name: 'Manual semifinal', participantCount: 4, participants: individualParticipants(4) });
    created.push(knockoutOnly);
    const knockoutState = await playAllPreliminaries(knockoutOnly);
    const validSemifinal = knockoutState.matches.find((match) => match.stage === 'SEMIFINALS')!;
    await setCurrentMatch(knockoutOnly, validSemifinal.id);
    const activated = await getTournamentState(knockoutOnly);
    expect(activated.currentMatchId).toBe(validSemifinal.id);
    expect(activated.matches.find((match) => match.id === validSemifinal.id)?.status).toBe('live');
  });

  it('profile images validate file signatures and update member image URLs', async () => {
    const id = await createTournament({ name: 'Player images', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    const before = await getTournamentState(id);
    const participantId = before.units[0].members[0].id;
    // Minimal valid PNG header is sufficient for this boundary validation test.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=', 'base64');
    await uploadParticipantImage(id, participantId, { mimeType: 'image/png', dataBase64: png.toString('base64') });
    let state = await getTournamentState(id);
    const imageUrl = state.units[0].members[0].imageUrl;
    expect(imageUrl).toMatch(/^\/api\/uploads\/profile_/);
    await expect(uploadParticipantImage(id, participantId, { mimeType: 'image/png', dataBase64: Buffer.from('not png').toString('base64') })).rejects.toThrow(/PNG/);
    const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
    await expect(uploadParticipantImage(id, participantId, { mimeType: 'image/png', dataBase64: tooLarge })).rejects.toThrow(/4 MB/);
    await removeParticipantImage(id, participantId);
    state = await getTournamentState(id);
    expect(state.units[0].members[0].imageUrl).toBeNull();
  });

  it('reset regenerates schedule and clears results', async () => {
    const id = await createTournament({ name: 'Reset', participantCount: 4, participants: individualParticipants(4) });
    created.push(id);
    await setTournamentState(id, 'PRELIMINARY');
    const state = await getTournamentState(id);
    const m = state.matches[0];
    await saveResult(id, m.id, { winnerUnitId: m.aUnitId!, aDamageDealt: 100, bDamageDealt: 50 });

    await resetTournament(id);
    const s = await getTournamentState(id);
    expect(s.state).toBe('SETUP');
    expect(s.matches.filter((x) => x.stage === 'PRELIMINARY')).toHaveLength(6);
    expect(s.matches.every((x) => x.status === 'waiting' && !x.result)).toBe(true);
  });

  it('team creation requires explicit pairing (no auto-teams)', async () => {
    await expect(
      createTournament({ name: 'NoTeams', participantCount: 8, participants: individualParticipants(8) }),
    ).rejects.toThrow(/requires 2-player teams/i);
    created.push('none');
  });

  it('rejects unsupported sizes and duplicate names', async () => {
    await expect(
      createTournament({ name: 'Bad', participantCount: 3, participants: individualParticipants(3) }),
    ).rejects.toThrow(/4-12/);
    await expect(
      createTournament({
        name: 'Dup',
        participantCount: 4,
        participants: [{ name: 'A' }, { name: 'a' }, { name: 'B' }, { name: 'C' }],
      }),
    ).rejects.toThrow(/unique/i);
  });

  it('deleteTournament removes all related data, including an active current-match reference', async () => {
    const { deleteTournament } = await import('../src/services/mutations.js');
    const id = await createTournament({ name: 'Del', participantCount: 4, participants: individualParticipants(4) });
    await setTournamentState(id, 'PRELIMINARY');
    const state = await getTournamentState(id);
    const match = state.matches.find((candidate) => candidate.stage === 'PRELIMINARY')!;
    await setCurrentMatch(id, match.id);
    expect((await getTournamentState(id)).currentMatchId).toBe(match.id);
    await deleteTournament(id);
    await expect(getTournamentState(id)).rejects.toThrow(/not found/i);
  });
});
