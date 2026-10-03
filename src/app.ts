import express from 'express';
import { randomUUID } from 'node:crypto';
import healthRouter from './routes/health.js';
import predictionRouter from './routes/prediction.js';
import reviewRouter from './routes/review.js';

export function createApp() {
  const app = express();

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '2mb' }));

  // Log request metadata only; never log request bodies or query strings.
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.on('finish', () => {
      console.info(JSON.stringify({
        event: 'http_request',
        request_id: requestId,
        method: req.method,
        status_code: res.statusCode,
        latency_ms: Date.now() - startedAt,
      }));
    });
    next();
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use('/health', healthRouter);
  app.use('/api/ml', predictionRouter);
  app.use('/api', predictionRouter);
  app.use('/api/review', reviewRouter);

  // ── 404 handler ─────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
  });

  // ── Global error handler ────────────────────────────────────────────────────
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ERROR]', message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message });
  });

  return app;
}
