import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/services/db.js';
import {
  createTournament,
  deleteTournament,
  navigatePresentation,
  updatePresentationDecks,
  setCurrentMatch,
  setPresentationActive,
  setPresentationVideoActive,
  setReadiness,
  setTournamentState,
  uploadPresentationVideo,
} from '../src/services/mutations.js';
import { getTournamentState } from '../src/services/state.js';

describe('feature smoke', () => {
  let tournamentId: string | null = null;
  afterAll(async () => {
    if (tournamentId) await deleteTournament(tournamentId);
    await prisma.$disconnect();
  });

  it('resets readiness and shares MP4 playback without changing tournament progression', async () => {
    tournamentId = await createTournament({
      name: 'Disposable feature smoke',
      participantCount: 4,
      participants: Array.from({ length: 4 }, (_, index) => ({ name: `Smoke ${index + 1}` })),
    });
    await setTournamentState(tournamentId, 'PRELIMINARY');
    let state = await getTournamentState(tournamentId);
    const match = state.matches[0];
    await setCurrentMatch(tournamentId, match.id);
    await setReadiness(tournamentId, match.aUnitId!, 'ready');
    await setReadiness(tournamentId, match.aUnitId!, 'waiting');
    state = await getTournamentState(tournamentId);
    expect(state.units.find((unit) => unit.id === match.aUnitId)?.readiness).toBe('waiting');

    const bytes = Buffer.alloc(32);
    bytes.write('ftyp', 4, 'ascii');
    await uploadPresentationVideo(tournamentId, bytes);
    await setPresentationVideoActive(tournamentId, true);
    state = await getTournamentState(tournamentId);
    expect(state.presentationVideo?.active).toBe(true);
    expect(state.currentMatchId).toBe(match.id);
    expect(state.state).toBe('PRELIMINARY');

    await setPresentationVideoActive(tournamentId, false);
    await updatePresentationDecks(tournamentId, [{ id: 'smoke', title: 'Smoke', slides: [
      { id: 'one', title: 'One', text: 'Slide one', imageUrl: null },
      { id: 'two', title: 'Two', text: 'Slide two', imageUrl: null },
    ] }]);
    await setPresentationActive(tournamentId, true);
    await navigatePresentation(tournamentId, 1);
    state = await getTournamentState(tournamentId);
    expect(state.presentation.active).toBe(true);
    expect(state.presentation.currentIndex).toBe(1);
  });
});
