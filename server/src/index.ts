// Express server entrypoint.

import 'dotenv/config';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT) || 8787; // treats PORT=0 as "use default"
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});
