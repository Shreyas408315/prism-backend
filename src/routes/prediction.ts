import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { originModelFeaturesSchema } from '../schemas/finding.js';
import { predictSingle, predictBatch } from '../services/mlClient.js';

const router = Router();

// ─── POST /api/ml/predict and /api/predict ───────────────────────────────────

const singlePredictionHandler = async (req: Request, res: Response) => {
  const parsed = originModelFeaturesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      details: parsed.error.format(),
    });
    return;
  }

  const result = await predictSingle(parsed.data);

  if (!result.ok) {
    const status =
      result.error.kind === 'HTTP' ? result.error.status :
      result.error.kind === 'TIMEOUT' ? 504 : 502;

    res.status(status).json({
      error: result.error.kind,
      message: result.error.message,
    });
    return;
  }

  res.status(200).json(result.data);
};

/**
 * POST /api/ml/predict
 * Proxy a single pre-built feature row directly to the ML service.
 */
router.post('/predict', singlePredictionHandler);
router.post('/', singlePredictionHandler);

// ─── POST /api/ml/predict/batch and /api/predict/batch ──────────────────────

const batchBodySchema = z.object({
  findings: z.array(originModelFeaturesSchema).min(1).max(500),
});

const batchPredictionHandler = async (req: Request, res: Response) => {
  const parsed = batchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      details: parsed.error.format(),
    });
    return;
  }

  const result = await predictBatch(parsed.data.findings);

  if (!result.ok) {
    const status =
      result.error.kind === 'HTTP' ? result.error.status :
      result.error.kind === 'TIMEOUT' ? 504 : 502;

    res.status(status).json({
      error: result.error.kind,
      message: result.error.message,
    });
    return;
  }

  res.status(200).json(result.data);
};

/**
 * POST /api/ml/predict/batch
 * Proxy multiple pre-built feature rows to the ML service batch endpoint.
 */
router.post('/predict/batch', batchPredictionHandler);
router.post('/batch', batchPredictionHandler);

export default router;
