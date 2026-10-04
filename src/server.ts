import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './db/database.js';

const app = createApp();

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[prism-backend] Listening on port ${env.PORT}`);
  console.log(`[prism-backend] ML timeout: ${env.ML_SERVICE_TIMEOUT_MS}ms`);
});

const shutdown = () => {
  server.close(() => {
    void closeDatabase().catch(() => {
      console.error('[prism-backend] Database pool shutdown failed');
      process.exitCode = 1;
    });
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
