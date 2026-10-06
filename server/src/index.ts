// Express server entrypoint.

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';
import { ServiceError } from './services/state.js';
import { api } from './routes/api.js';

const app = express();
app.use(cors());
// Install the bounded raw parser before JSON, only on the MP4 binary endpoint.
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

const port = Number(process.env.PORT) || 8787; // treats PORT=0 as "use default"
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
