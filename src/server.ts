import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[prism-backend] Listening on port ${env.PORT}`);
  console.log(`[prism-backend] ML timeout: ${env.ML_SERVICE_TIMEOUT_MS}ms`);
});
