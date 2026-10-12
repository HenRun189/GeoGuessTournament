import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from './db.js';
import { ServiceError } from './state.js';

const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const failedLogins = new Map<string, { count: number; windowStartedAt: number; blockedUntil: number }>();

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function loginBucketKey(clientKey: string): string {
  return createHash('sha256').update(clientKey || 'unknown').digest('hex');
}

export async function createAdminSession(password: string, clientKey = 'unknown'): Promise<{ token: string; expiresAt: string }> {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) throw new ServiceError('Admin-Anmeldung ist serverseitig nicht konfiguriert', 503);
  const now = Date.now();
  const key = loginBucketKey(clientKey);
  const attempts = failedLogins.get(key);
  if (attempts && attempts.blockedUntil > now) throw new ServiceError('Zu viele Anmeldeversuche. Bitte später erneut versuchen.', 429);
  if (attempts && now - attempts.windowStartedAt >= LOGIN_WINDOW_MS) failedLogins.delete(key);

  const passwordBytes = Buffer.from(typeof password === 'string' ? password.slice(0, 256) : '');
  const expectedBytes = Buffer.from(configuredPassword);
  const digestMatches = timingSafeEqual(createHash('sha256').update(passwordBytes).digest(), createHash('sha256').update(expectedBytes).digest());
  const accepted = typeof password === 'string' && password.length <= 256 && passwordBytes.length === expectedBytes.length && digestMatches;
  if (!accepted) {
    const current = failedLogins.get(key);
    const next = !current || now - current.windowStartedAt >= LOGIN_WINDOW_MS
      ? { count: 1, windowStartedAt: now, blockedUntil: 0 }
      : { ...current, count: current.count + 1 };
    if (next.count >= LOGIN_MAX_ATTEMPTS) next.blockedUntil = now + LOGIN_WINDOW_MS;
    failedLogins.set(key, next);
    throw new ServiceError('Admin-Passwort ist falsch', 401);
  }
  failedLogins.delete(key);

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(now + SESSION_LIFETIME_MS);
  await prisma.globalAdminSession.create({ data: { tokenHash: tokenHash(token), expiresAt } });
  if (Math.random() < 0.05) {
    await prisma.globalAdminSession.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    if (failedLogins.size > 10_000) {
      for (const [bucket, state] of failedLogins) if (now - state.windowStartedAt >= LOGIN_WINDOW_MS) failedLogins.delete(bucket);
    }
  }
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function isAdminSessionValid(token: string | undefined): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return false;
  const session = await prisma.globalAdminSession.findFirst({
    where: { tokenHash: tokenHash(token), expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return session !== null;
}

export async function revokeAdminSession(token: string | undefined): Promise<void> {
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) return;
  await prisma.globalAdminSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
