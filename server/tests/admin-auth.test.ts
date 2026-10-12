import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/services/db.js';
import { createTournament, deleteTournament } from '../src/services/mutations.js';
import { createAdminSession } from '../src/services/auth.js';

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

function createBody(name: string) {
  return {
    name,
    participantCount: 4,
    participants: Array.from({ length: 4 }, (_, index) => ({ name: `${name} player ${index + 1}` })),
  };
}

describe('global admin authorization', () => {
  beforeAll(async () => {
    tournamentId = await createTournament(createBody('HTTP global auth regression'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (tournamentId) await deleteTournament(tournamentId);
  });

  it('denies unauthenticated creation/admin routes and preserves public display and player actions', async () => {
    const deniedCreate = await post('/tournaments', createBody('Should not exist'));
    expect(deniedCreate.status).toBe(401);
    const deniedDemo = await post('/demo', { kind: 'full' });
    expect(deniedDemo.status).toBe(401);

    const publicList = await fetch(`${baseUrl}/tournaments`);
    expect(publicList.status).toBe(200);
    const publicResponse = await fetch(`${baseUrl}/tournaments/${tournamentId}`);
    expect(publicResponse.status).toBe(200);
    const publicState = await publicResponse.json() as { matches: { id: string }[]; units: { id: string; members: { id: string }[] }[] };
    const firstUnit = publicState.units[0];
    expect((await fetch(`${baseUrl}/tournaments/${tournamentId}/player/${firstUnit.id}`)).status).toBe(200);
    expect((await post(`/tournaments/${tournamentId}/units/${firstUnit.id}/readiness`, { readiness: 'ready' })).status).toBe(200);
    expect((await post(`/tournaments/${tournamentId}/units/${firstUnit.id}/problem`, { message: 'Public player help' })).status).toBe(200);

    const paths: [string, unknown, string?][] = [
      [`/tournaments/${tournamentId}/state`, { state: 'PRELIMINARY' }],
      [`/tournaments/${tournamentId}/reset`, {}],
      [`/tournaments/${tournamentId}/units/${firstUnit.id}/ping`, {}],
      [`/tournaments/${tournamentId}/units/${firstUnit.id}/problem/resolve`, {}],
      [`/tournaments/${tournamentId}/participants/${firstUnit.members[0].id}/image`, { mimeType: 'image/png', dataBase64: '' }],
      [`/tournaments/${tournamentId}/current-match`, { matchId: publicState.matches[0].id }],
      ['/demo', {}, 'DELETE'],
    ];
    for (const [path, body, method = 'POST'] of paths) {
      const response = await post(path, body, undefined, method);
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect((await post(`/tournaments/${tournamentId}`, {}, undefined, 'DELETE')).status).toBe(401);
    const uploadDenied = await fetch(`${baseUrl}/tournaments/${tournamentId}/presentation/video`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(1024),
    });
    expect(uploadDenied.status).toBe(401);
  });

  it('rejects incorrect passwords, issues one global cookie session and permits creation across tournaments', async () => {
    const wrongLogin = await post('/admin-session', { password: 'wrong-password' });
    expect(wrongLogin.status).toBe(401);
    expect((await wrongLogin.json()).error).toBe('Admin-Passwort ist falsch');

    const login = await post('/admin-session', { password: 'global-test-admin-password' });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ authenticated: true });
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toMatch(/^gt_admin=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=');
    expect(cookie).not.toContain('global-test-admin-password');
    const cookiePair = cookie!.split(';')[0];

    const created = await post('/tournaments', createBody('Created by global admin'), cookiePair);
    expect(created.status).toBe(200);
    const createdId = (await created.json()).id as string;
    try {
      const secondTournament = await createTournament(createBody('Second tournament'));
      try {
        const adminResponse = await post(`/tournaments/${secondTournament}/state`, { state: 'PRELIMINARY' }, cookiePair);
        expect(adminResponse.status).toBe(200);
      } finally { await deleteTournament(secondTournament); }
      const state = await prisma.tournament.findUnique({ where: { id: createdId }, select: { id: true } });
      expect(state?.id).toBe(createdId);
    } finally { await deleteTournament(createdId); }

    const reloadSession = await fetch(`${baseUrl}/admin-session`, { headers: { cookie: cookiePair } });
    expect(await reloadSession.json()).toEqual({ authenticated: true });
    const protectedAction = await post(`/tournaments/${tournamentId}/state`, { state: 'PRELIMINARY' }, cookiePair);
    expect(protectedAction.status).toBe(200);
    await prisma.tournament.update({ where: { id: tournamentId }, data: { state: 'SETUP' } });

    const logout = await post('/admin-session', {}, cookiePair, 'DELETE');
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    const loggedOut = await fetch(`${baseUrl}/admin-session`, { headers: { cookie: cookiePair } });
    expect(await loggedOut.json()).toEqual({ authenticated: false });
    expect((await post(`/tournaments/${tournamentId}/reset`, {}, cookiePair)).status).toBe(401);
  });

  it('rejects sessions with expired timestamps and fails closed without password configuration', async () => {
    const session = await createAdminSession('global-test-admin-password', 'expired-session-test');
    await prisma.globalAdminSession.updateMany({ where: { tokenHash: { not: '' } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await fetch(`${baseUrl}/admin-session`, { headers: { cookie: `gt_admin=${session.token}` } })).status).toBe(200);
    expect(await (await fetch(`${baseUrl}/admin-session`, { headers: { cookie: `gt_admin=${session.token}` } })).json()).toEqual({ authenticated: false });
    expect((await post(`/tournaments/${tournamentId}/reset`, {}, `gt_admin=${session.token}`)).status).toBe(401);

    const configuredPassword = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    try {
      const missingConfig = await post('/admin-session', { password: 'anything' });
      expect(missingConfig.status).toBe(503);
    } finally { process.env.ADMIN_PASSWORD = configuredPassword; }
  });
});
