import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { prisma } from './db.js';
import { ServiceError } from './state.js';

const scryptCallback = (password: string | Buffer, salt: string | Buffer, length: number, options: ScryptOptions): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, length, options, (error, derived) => error ? reject(error) : resolve(derived));
});
const PASSWORD_COST = 16_384;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashAdminPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    throw new ServiceError('Das Admin-Passwort muss zwischen 10 und 256 Zeichen lang sein');
  }
  const salt = randomBytes(16);
  const derived = await scryptCallback(password, salt, 64, { N: PASSWORD_COST, r: 8, p: 1 });
  return `scrypt$${PASSWORD_COST}$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyAdminPassword(password: string, encoded: string | null): Promise<boolean> {
  if (!encoded || typeof password !== 'string') return false;
  const [algorithm, n, r, p, saltHex, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== String(PASSWORD_COST) || r !== '8' || p !== '1' || !/^[0-9a-f]{32}$/i.test(saltHex ?? '') || !/^[0-9a-f]{128}$/i.test(expectedHex ?? '')) return false;
  const actual = await scryptCallback(password, Buffer.from(saltHex, 'hex'), 64, { N: PASSWORD_COST, r: 8, p: 1 });
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAdminSession(tournamentId: string, password: string): Promise<{ token: string; expiresAt: string }> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { adminPasswordHash: true } });
  if (!tournament) throw new ServiceError('Turnier nicht gefunden', 404);
  if (!(await verifyAdminPassword(password, tournament.adminPasswordHash))) throw new ServiceError('Admin-Passwort ist falsch', 401);
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await prisma.adminSession.create({ data: { tournamentId, tokenHash: tokenHash(token), expiresAt } });
  return { token, expiresAt: expiresAt.toISOString() };
}

export function hashAdminSessionToken(token: string): string {
  return tokenHash(token);
}

export async function isAdminSessionValid(tournamentId: string, token: string | undefined): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return false;
  const session = await prisma.adminSession.findFirst({
    where: { tournamentId, tokenHash: tokenHash(token), expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return session !== null;
}


export async function revokeAdminSession(tournamentId: string, token: string | undefined): Promise<void> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return;
  await prisma.adminSession.deleteMany({ where: { tournamentId, tokenHash: tokenHash(token) } });
}
