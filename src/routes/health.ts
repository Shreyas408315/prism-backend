import { Router } from 'express';

const router = Router();

/**
 * GET /health
 * Returns the exact backend liveness contract expected by the PRism deployment.
 */
router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'prism-backend',
  });
});

export default router;
