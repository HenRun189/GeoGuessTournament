import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/db.js';
import { createTournament, deleteTournament } from '../src/services/mutations.js';

const server = createServer(createApp());
let baseUrl = '';
let tournamentId = '';

async function post(path: string, body: unknown, cookie?: string, method = 'POST'): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
  });
}

describe('admin API authorization', () => {
  beforeAll(async () => {
    tournamentId = await createTournament({
      name: 'HTTP auth regression',
      participantCount: 4,
      adminPassword: 'secure-test-password-123',
      participants: Array.from({ length: 4 }, (_, index) => ({ name: `Auth player ${index + 1}` })),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (tournamentId) await deleteTournament(tournamentId);
  });

  it('denies URL-only access to every privileged route and keeps public player actions available', async () => {
    const publicState = await fetch(`${baseUrl}/tournaments/${tournamentId}`);
    expect(publicState.status).toBe(200);
    const publicBody = await publicState.text();
    expect(publicBody).not.toContain('secure-test-password-123');
    expect(publicBody).not.toContain('adminPasswordHash');
    expect(publicBody).not.toContain('scrypt$');

    const initial = await (await fetch(`${baseUrl}/tournaments/${tournamentId}`)).json() as { matches: { id: string }[]; units: { id: string; members: { id: string }[] }[] };
    const unitId = initial.units[0].id;
    const participantId = initial.units[0].members[0].id;
    const paths: [string, unknown, string?][] = [
      [`/tournaments/${tournamentId}/state`, { state: 'PRELIMINARY' }],
      [`/tournaments/${tournamentId}/reset`, {}],
      [`/tournaments/${tournamentId}/pause`, { paused: true }],
      [`/tournaments/${tournamentId}/units/${unitId}/ping`, {}],
      [`/tournaments/${tournamentId}/units/${unitId}/problem/resolve`, {}],
      [`/tournaments/${tournamentId}/participants/${participantId}/image`, { mimeType: 'image/png', dataBase64: '' }],
      [`/tournaments/${tournamentId}/current-match`, { matchId: initial.matches[0].id }],
      [`/tournaments/${tournamentId}/matches/${initial.matches[0].id}/result`, { winnerUnitId: unitId, aDamageDealt: 1, bDamageDealt: 1 }],
      [`/tournaments/${tournamentId}/matches/${initial.matches[0].id}/result`, { winnerUnitId: unitId, aDamageDealt: 1, bDamageDealt: 1 }, 'PUT'],
      [`/tournaments/${tournamentId}/undo`, {}],
      [`/tournaments/${tournamentId}/overlay-settings`, { autoRotation: false }, 'PATCH'],
      [`/tournaments/${tournamentId}/presentation/decks`, { decks: [] }, 'PUT'],
      [`/tournaments/${tournamentId}/presentation/deck`, { deckId: 'not-a-deck' }],
      [`/tournaments/${tournamentId}/presentation/video/active`, { active: true }],
      [`/tournaments/${tournamentId}/presentation/active`, { active: true }],
      [`/tournaments/${tournamentId}/presentation/navigate`, { direction: 1 }],
      [`/tournaments/${tournamentId}/overlay-mode`, { mode: 'all_matches' }],
    ];
    for (const [path, body, method = 'POST'] of paths) {
      const response = await post(path, body, undefined, method);
      expect(response.status, `${method} ${path}`).toBe(401);
      expect((await response.json()).error).toMatch(/Admin-Anmeldung/);
    }

    const deniedDelete = await post(`/tournaments/${tournamentId}`, {}, undefined, 'DELETE');
    expect(deniedDelete.status).toBe(401);
    const deniedImageDelete = await post(`/tournaments/${tournamentId}/participants/${participantId}/image`, {}, undefined, 'DELETE');
    expect(deniedImageDelete.status).toBe(401);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { isDemo: true } });
    const deniedBulkDemoDelete = await post('/demo', {}, undefined, 'DELETE');
    expect(deniedBulkDemoDelete.status).toBe(401);
    expect((await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } }))?.id).toBe(tournamentId);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { isDemo: false } });
    const uploadDenied = await fetch(`${baseUrl}/tournaments/${tournamentId}/presentation/video`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(1024),
    });
    expect(uploadDenied.status).toBe(401);
    const malformedCookieUpload = await fetch(`${baseUrl}/tournaments/${tournamentId}/presentation/video`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', cookie: `gt_admin_${tournamentId}=%ZZ` },
      body: Buffer.alloc(1024),
    });
    expect(malformedCookieUpload.status).toBe(401);

    const readiness = await post(`/tournaments/${tournamentId}/units/${unitId}/readiness`, { readiness: 'in_game' });
    expect(readiness.status).toBe(200);
    const report = await post(`/tournaments/${tournamentId}/units/${unitId}/problem`, { message: 'HTTP public-help test' });
    expect(report.status).toBe(200);
    const withdrawalToken = (await report.json()).withdrawalToken as string;
    const withdraw = await post(`/tournaments/${tournamentId}/units/${unitId}/problem/withdraw`, { withdrawalToken });
    expect(withdraw.status).toBe(200);
    expect((await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { state: true } }))?.state).toBe('SETUP');
  });

  it('grants only after password login and retains the tournament-scoped session after reload', async () => {
    const wrongLogin = await post(`/tournaments/${tournamentId}/admin-session`, { password: 'wrong-password-123' });
    expect(wrongLogin.status).toBe(401);
    const login = await post(`/tournaments/${tournamentId}/admin-session`, { password: 'secure-test-password-123' });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ authenticated: true });
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toMatch(/^gt_admin_/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('secure-test-password-123');
    const cookiePair = cookie!.split(';')[0];
    const mp4 = Buffer.alloc(32);
    mp4.write('ftyp', 4, 'ascii');
    const permittedUpload = await fetch(`${baseUrl}/tournaments/${tournamentId}/presentation/video`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', cookie: cookiePair },
      body: mp4,
    });
    expect(permittedUpload.status).toBe(200);

    const session = await fetch(`${baseUrl}/tournaments/${tournamentId}/admin-session`, { headers: { cookie: cookiePair } });
    expect(await session.json()).toEqual({ authenticated: true });
    const allowed = await post(`/tournaments/${tournamentId}/state`, { state: 'PRELIMINARY' }, cookiePair);
    expect(allowed.status).toBe(200);
    expect((await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { state: true } }))?.state).toBe('PRELIMINARY');

    const logout = await post(`/tournaments/${tournamentId}/admin-session`, {}, cookiePair, 'DELETE');
    expect(logout.status).toBe(200);
    const loggedOutCheck = await fetch(`${baseUrl}/tournaments/${tournamentId}/admin-session`, { headers: { cookie: cookiePair } });
    expect(await loggedOutCheck.json()).toEqual({ authenticated: false });
    const afterLogout = await post(`/tournaments/${tournamentId}/reset`, {}, cookiePair);
    expect(afterLogout.status).toBe(401);
  });
});
