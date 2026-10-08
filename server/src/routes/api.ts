// HTTP API routes for the tournament app.

import { Router } from 'express';
import type { TournamentState, OverlayOverrideDTO, PresentationDeckDTO } from '@gt/shared';
import { addClient, prisma } from '../services/db.js';
import { getTournamentState, ServiceError } from '../services/state.js';
import {
  createTournament, saveResult, editResult, undoLastResult, setTournamentState, resetTournament,
  deleteTournament, deleteDemoTournaments, setCurrentMatch, sendManualPing, setReadiness,
  reportProblem, withdrawProblem, resolveProblem, uploadParticipantImage, removeParticipantImage,
  setPaused, updateOverlaySettings, setOverlayMode, updatePresentationDecks, selectPresentationDeck,
  navigatePresentation, setPresentationActive, uploadPresentationVideo, setPresentationVideoActive,
  createDemoTournament,
} from '../services/mutations.js';
import { createAdminSession, hashAdminSessionToken, isAdminSessionValid, revokeAdminSession } from '../services/auth.js';
import type { Request, Response, NextFunction } from 'express';

export const api = Router();

function adminToken(req: Request, tournamentId: string): string | undefined {
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearer) return bearer;
  const prefix = `gt_admin_${tournamentId}=`;
  const entry = (req.header('cookie')?.split(';') ?? []).map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(prefix));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.slice(prefix.length)); } catch { return undefined; }
}

function setAdminCookie(res: Response, tournamentId: string, token: string, expiresAt: string): void {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gt_admin_${tournamentId}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/api; HttpOnly; SameSite=Strict${secure}`);
}

function clearAdminCookie(res: Response, tournamentId: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gt_admin_${tournamentId}=; Max-Age=0; Path=/api; HttpOnly; SameSite=Strict${secure}`);
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res)
      .then((data) => { if (!res.headersSent) res.json(data ?? { ok: true }); })
      .catch((err: unknown) => {
        if (res.headersSent) return;
        if (err instanceof ServiceError) res.status(err.status).json({ error: err.message });
        else {
          console.error(err);
          res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
        }
      });
  };
}

const adminOnly = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tournamentId = String(req.params.id ?? '');
    if (!tournamentId || !(await isAdminSessionValid(tournamentId, adminToken(req, tournamentId)))) {
      res.status(401).json({ error: 'Admin-Anmeldung erforderlich' });
      return;
    }
    next();
  } catch (error) { next(error); }
};

// ---- SSE live updates ----
api.get('/events', (req, res) => {
  const tournamentId = String(req.query.tournamentId ?? '');
  if (!tournamentId) { res.status(400).json({ error: 'tournamentId query param required' }); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const remove = addClient(tournamentId, (chunk) => res.write(chunk));
  const ping = setInterval(() => { try { res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`); } catch { /* noop */ } }, 15000);
  req.on('close', () => { clearInterval(ping); remove(); });
});

// ---- admin authentication ----
api.post('/tournaments/:id/admin-session', handle(async (req, res) => {
  const session = await createAdminSession(String(req.params.id), String(req.body?.password ?? ''));
  setAdminCookie(res, String(req.params.id), session.token, session.expiresAt);
  return { authenticated: true, expiresAt: session.expiresAt };
}));
api.get('/tournaments/:id/admin-session', handle(async (req) => ({ authenticated: await isAdminSessionValid(String(req.params.id), adminToken(req, String(req.params.id))) })));
api.delete('/tournaments/:id/admin-session', handle(async (req, res) => {
  const id = String(req.params.id);
  await revokeAdminSession(id, adminToken(req, id));
  clearAdminCookie(res, id);
  return { ok: true };
}));

// ---- tournament read/public routes ----
api.get('/tournaments', handle(async () => {
  const rows = await prisma.tournament.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, state: true, participantCount: true, createdAt: true, isDemo: true } });
  return { tournaments: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
}));
api.post('/tournaments', handle(async (req, res) => {
  if (typeof req.body?.adminPassword !== 'string') throw new ServiceError('Admin-Passwort ist erforderlich');
  const id = await createTournament(req.body);
  const session = await createAdminSession(id, req.body.adminPassword);
  setAdminCookie(res, id, session.token, session.expiresAt);
  return { id };
}));
api.get('/tournaments/:id', handle(async (req) => getTournamentState(String(req.params.id))));
api.get('/tournaments/:id/player/:unitId', handle(async (req) => {
  const tournamentId = String(req.params.id);
  const unitId = String(req.params.unitId);
  const state = await getTournamentState(tournamentId);
  const view = state.playerViews[unitId] ?? null;
  if (!view) throw new ServiceError('Player not found', 404);
  return { ...view, tournamentId, playerId: unitId };
}));

// ---- admin-only tournament controls ----
api.delete('/tournaments/:id', adminOnly, handle(async (req) => { await deleteTournament(String(req.params.id)); return { ok: true }; }));
api.post('/tournaments/:id/state', adminOnly, handle(async (req) => { await setTournamentState(String(req.params.id), req.body?.state as TournamentState); return { ok: true }; }));
api.post('/tournaments/:id/reset', adminOnly, handle(async (req) => { await resetTournament(String(req.params.id)); return { ok: true }; }));
api.post('/tournaments/:id/pause', adminOnly, handle(async (req) => { await setPaused(String(req.params.id), Boolean(req.body?.paused)); return { ok: true }; }));
api.post('/tournaments/:id/units/:unitId/ping', adminOnly, handle(async (req) => { await sendManualPing(String(req.params.id), String(req.params.unitId)); return { ok: true }; }));
api.post('/tournaments/:id/units/:unitId/readiness', handle(async (req) => {
  const readiness = req.body?.readiness;
  if (readiness !== 'waiting' && readiness !== 'ready' && readiness !== 'in_game') throw new ServiceError('Ungültiger Bereitschaftsstatus');
  await setReadiness(String(req.params.id), String(req.params.unitId), readiness);
  return { ok: true };
}));
api.post('/tournaments/:id/units/:unitId/problem', handle(async (req) => reportProblem(String(req.params.id), String(req.params.unitId), String(req.body?.message ?? ''))));
api.post('/tournaments/:id/units/:unitId/problem/withdraw', handle(async (req) => { await withdrawProblem(String(req.params.id), String(req.params.unitId), String(req.body?.withdrawalToken ?? '')); return { ok: true }; }));
api.post('/tournaments/:id/units/:unitId/problem/resolve', adminOnly, handle(async (req) => { await resolveProblem(String(req.params.id), String(req.params.unitId)); return { ok: true }; }));
api.post('/tournaments/:id/participants/:participantId/image', adminOnly, handle(async (req) => { await uploadParticipantImage(String(req.params.id), String(req.params.participantId), req.body); return { ok: true }; }));
api.delete('/tournaments/:id/participants/:participantId/image', adminOnly, handle(async (req) => { await removeParticipantImage(String(req.params.id), String(req.params.participantId)); return { ok: true }; }));
api.post('/tournaments/:id/current-match', adminOnly, handle(async (req) => { await setCurrentMatch(String(req.params.id), req.body?.matchId ?? null); return { ok: true }; }));
api.post('/tournaments/:id/matches/:matchId/result', adminOnly, handle(async (req) => { await saveResult(String(req.params.id), String(req.params.matchId), req.body); return { ok: true }; }));
api.put('/tournaments/:id/matches/:matchId/result', adminOnly, handle(async (req) => { await editResult(String(req.params.id), String(req.params.matchId), req.body); return { ok: true }; }));
api.post('/tournaments/:id/undo', adminOnly, handle(async (req) => { await undoLastResult(String(req.params.id)); return { ok: true }; }));
api.patch('/tournaments/:id/overlay-settings', adminOnly, handle(async (req) => { await updateOverlaySettings(String(req.params.id), req.body ?? {}); return { ok: true }; }));
api.put('/tournaments/:id/presentation/decks', adminOnly, handle(async (req) => { await updatePresentationDecks(String(req.params.id), req.body?.decks as PresentationDeckDTO[]); return { ok: true }; }));
api.post('/tournaments/:id/presentation/deck', adminOnly, handle(async (req) => { await selectPresentationDeck(String(req.params.id), String(req.body?.deckId ?? '')); return { ok: true }; }));
api.post('/tournaments/:id/presentation/video', adminOnly, handle(async (req) => { if (!Buffer.isBuffer(req.body)) throw new ServiceError('MP4-Upload muss als Binärdatei gesendet werden'); await uploadPresentationVideo(String(req.params.id), req.body); return { ok: true }; }));
api.post('/tournaments/:id/presentation/video/active', adminOnly, handle(async (req) => { await setPresentationVideoActive(String(req.params.id), req.body?.active === true); return { ok: true }; }));
api.post('/tournaments/:id/presentation/active', adminOnly, handle(async (req) => { await setPresentationActive(String(req.params.id), req.body?.active === true); return { ok: true }; }));
api.post('/tournaments/:id/presentation/navigate', adminOnly, handle(async (req) => {
  const direction = req.body?.direction;
  if (direction !== -1 && direction !== 1) throw new ServiceError('Ungültige Präsentationsrichtung');
  await navigatePresentation(String(req.params.id), direction);
  return { ok: true };
}));
api.post('/tournaments/:id/overlay-mode', adminOnly, handle(async (req) => { await setOverlayMode(String(req.params.id), (req.body?.mode ?? 'auto') as OverlayOverrideDTO['mode']); return { ok: true }; }));

// Demo generation/deletion are admin operations too; generated demos share the password flow.
api.post('/demo', handle(async (req, res) => {
  const kind = (req.body?.kind ?? 'full') as 'full' | 'team' | 'groups';
  const password = String(req.body?.adminPassword ?? '');
  const id = await createDemoTournament(kind, password);
  const session = await createAdminSession(id, password);
  setAdminCookie(res, id, session.token, session.expiresAt);
  return { id };
}));
api.delete('/demo', handle(async (req, res) => {
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const cookies = (req.header('cookie')?.split(';') ?? []).map((cookie) => cookie.trim());
  const tokens = [bearer, ...cookies.filter((cookie) => cookie.startsWith('gt_admin_')).map((cookie) => {
    try { return decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)); } catch { return ''; }
  })].filter((token): token is string => Boolean(token));
  const sessions = tokens.length ? await prisma.adminSession.findMany({ where: { tokenHash: { in: tokens.map((token) => hashAdminSessionToken(token)) }, expiresAt: { gt: new Date() } }, select: { tournamentId: true } }) : [];
  const demos = await prisma.tournament.findMany({ where: { isDemo: true }, select: { id: true } });
  if (demos.some((demo) => !sessions.some((session) => session.tournamentId === demo.id))) throw new ServiceError('Admin-Anmeldung für alle Demo-Turniere erforderlich', 401);
  const removed = await deleteDemoTournaments();
  return { removed };
}));
