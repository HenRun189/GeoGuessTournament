// HTTP API routes for the tournament app.

import { Router } from 'express';
import type { PlayerViewDTO, TournamentState, OverlayOverrideDTO } from '@gt/shared';
import { addClient } from '../services/db.js';
import { getTournamentState, ServiceError } from '../services/state.js';
import {
  createTournament,
  saveResult,
  undoLastResult,
  setTournamentState,
  resetTournament,
  deleteTournament,
  deleteDemoTournaments,
  setCurrentMatch,
  sendManualPing,
  setPaused,
  updateOverlaySettings,
  setOverlayMode,
  createDemoTournament,
} from '../services/mutations.js';
import { prisma } from '../services/db.js';

export const api = Router();

function handle(fn: (req: any, res: any) => Promise<unknown>) {
  return (req: any, res: any) => {
    fn(req, res)
      .then((data) => res.json(data ?? { ok: true }))
      .catch((err: unknown) => {
        if (err instanceof ServiceError) {
          res.status(err.status).json({ error: err.message });
        } else {
          console.error(err);
          res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
        }
      });
  };
}

// ---- SSE live updates ----

api.get('/events', (req, res) => {
  const tournamentId = String(req.query.tournamentId ?? '');
  if (!tournamentId) {
    res.status(400).json({ error: 'tournamentId query param required' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const remove = addClient(tournamentId, (chunk) => res.write(chunk));
  const ping = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
    } catch {
      /* noop */
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(ping);
    remove();
  });
});

// ---- tournaments ----

api.get(
  '/tournaments',
  handle(async () => {
    const rows = await prisma.tournament.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, state: true, participantCount: true, createdAt: true, isDemo: true },
    });
    return {
      tournaments: rows.map((r) => ({
        id: r.id,
        name: r.name,
        state: r.state,
        participantCount: r.participantCount,
        createdAt: r.createdAt.toISOString(),
        isDemo: r.isDemo,
      })),
    };
  }),
);

api.post(
  '/tournaments',
  handle(async (req) => {
    const id = await createTournament(req.body);
    return { id };
  }),
);

api.get(
  '/tournaments/:id',
  handle(async (req) => {
    return await getTournamentState(req.params.id);
  }),
);

api.get(
  '/tournaments/:id/player/:unitId',
  handle(async (req) => {
    const tournamentId = req.params.id;
    const unitId = req.params.unitId;
    const state = await getTournamentState(tournamentId);
    const view = state.playerViews[unitId] ?? null;
    if (!view) throw new ServiceError('Player not found', 404);
    return { ...view, tournamentId, playerId: unitId };
  }),
);

api.delete(
  '/tournaments/:id',
  handle(async (req) => {
    await deleteTournament(req.params.id);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/state',
  handle(async (req) => {
    const state = req.body?.state as TournamentState;
    await setTournamentState(req.params.id, state);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/reset',
  handle(async (req) => {
    await resetTournament(req.params.id);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/pause',
  handle(async (req) => {
    await setPaused(req.params.id, Boolean(req.body?.paused));
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/units/:unitId/ping',
  handle(async (req) => {
    await sendManualPing(req.params.id, req.params.unitId);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/current-match',
  handle(async (req) => {
    await setCurrentMatch(req.params.id, req.body?.matchId ?? null);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/matches/:matchId/result',
  handle(async (req) => {
    await saveResult(req.params.id, req.params.matchId, req.body);
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/undo',
  handle(async (req) => {
    await undoLastResult(req.params.id);
    return { ok: true };
  }),
);

api.patch(
  '/tournaments/:id/overlay-settings',
  handle(async (req) => {
    await updateOverlaySettings(req.params.id, req.body ?? {});
    return { ok: true };
  }),
);

api.post(
  '/tournaments/:id/overlay-mode',
  handle(async (req) => {
    await setOverlayMode(req.params.id, (req.body?.mode ?? 'auto') as OverlayOverrideDTO['mode']);
    return { ok: true };
  }),
);

// ---- demo ----

api.post(
  '/demo',
  handle(async (req) => {
    const kind = (req.body?.kind ?? 'full') as 'full' | 'team' | 'groups';
    const id = await createDemoTournament(kind);
    return { id };
  }),
);

api.delete(
  '/demo',
  handle(async () => {
    const removed = await deleteDemoTournaments();
    return { removed };
  }),
);
