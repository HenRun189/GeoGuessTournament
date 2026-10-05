// Runs before test modules are imported: configure DB and push schema once.

process.env.DATABASE_URL = 'file:./test.db';
process.env.PORT = '0';

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = join(here, '..', 'test.db');
if (existsSync(dbFile)) unlinkSync(dbFile);

execSync('npx prisma db push --skip-generate', {
  cwd: join(here, '..'),
  env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  stdio: 'ignore',
});
