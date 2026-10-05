// Express server entrypoint.

import express from 'express';
import cors from 'cors';
import { api } from './routes/api.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', api);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT) || 8787; // treats PORT=0 as "use default"
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
