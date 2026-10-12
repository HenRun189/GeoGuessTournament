// Configured Express application; separated from the listener for HTTP integration tests.

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { ServiceError } from './services/state.js';
import { api } from './routes/api.js';
import { isAdminSessionValid } from './services/auth.js';

function adminTokenFromRequest(req: express.Request): string | undefined {
  const entry = (req.header('cookie')?.split(';') ?? []).map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('gt_admin='));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.slice('gt_admin='.length)); } catch { return undefined; }
}

export function createApp() {
  const app = express();
  app.use(cors());
  // Authorize MP4 uploads before buffering the potentially large request body.
  app.use('/api/tournaments/:id/presentation/video', (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    void isAdminSessionValid(bearer ?? adminTokenFromRequest(req)).then((valid) => {
      if (!valid) { res.status(401).json({ error: 'Admin-Anmeldung erforderlich' }); return; }
      next();
    }).catch(next);
  });
  // Install the bounded raw parser only after upload authorization and before JSON parsing.
  app.use('/api/tournaments/:id/presentation/video', express.raw({ type: 'application/octet-stream', limit: '100mb' }));
  app.use(express.json({ limit: '6mb' }));

  const uploadRoot = fileURLToPath(new URL('../uploads/', import.meta.url));
  app.get('/api/uploads/:filename', (req, res, next) => {
    if (!/^(profile_[a-zA-Z0-9_-]+\.(png|jpg|webp)|presentation_[a-zA-Z0-9_-]+\.mp4)$/.test(req.params.filename)) {
      res.status(404).end();
      return;
    }
    const imagePath = join(uploadRoot, basename(req.params.filename));
    if (req.params.filename.endsWith('.mp4')) {
      res.type('video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
    }
    res.sendFile(imagePath, (error) => {
      if (error) next(error);
    });
  });

  app.use('/api', api);
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const parserError = error as { type?: string; status?: number };
    if (parserError?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Ungültige Anfrage' });
      return;
    }
    if (parserError?.type === 'entity.too.large' || parserError?.status === 413) {
      res.status(413).json({ error: 'Anfrage ist zu groß (MP4 maximal 100 MB)' });
      return;
    }
    const serviceError = error instanceof ServiceError ? error : null;
    res.status(serviceError?.status ?? 500).json({ error: serviceError?.message ?? 'Interner Serverfehler' });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
