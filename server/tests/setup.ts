// Runs before test modules are imported: configure DB and push schema once.

process.env.DATABASE_URL = 'file:./test.db';
process.env.PORT = '0';
process.env.ADMIN_PASSWORD = 'global-test-admin-password';

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = join(here, '..', 'prisma', 'test.db');
// Vitest evaluates setupFiles for each test module. Initialize the shared SQLite
// database only once per worker; later evaluations must not unlink an open DB.
if (process.env.GT_TEST_DATABASE_INITIALIZED !== '1') {
  if (existsSync(dbFile)) unlinkSync(dbFile);
  execSync('npx prisma db push --skip-generate', {
    cwd: join(here, '..'),
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'ignore',
  });
  process.env.GT_TEST_DATABASE_INITIALIZED = '1';
}
