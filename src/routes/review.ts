import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { surfaceModelFeaturesSchema } from '../schemas/finding.js';
import { evaluateReview } from '../services/reviewService.js';

const router = Router();

// ─── Request schema ───────────────────────────────────────────────────────────

const findingWithContextSchema = z.object({
  features: surfaceModelFeaturesSchema,
  finding_id: z.string().optional(),
  file_path: z.string().min(1),
});

const evaluateRequestSchema = z.object({
  repository: z.string().min(1),
  pull_request: z.union([z.number().int().positive(), z.string().min(1)]),
  findings: z.array(findingWithContextSchema).min(0).max(1000),
});

// ─── POST /api/review/evaluate ────────────────────────────────────────────────

/**
 * POST /api/review/evaluate
 *
 * Main PRism orchestration endpoint.
 * Accepts already-engineered 43-feature rows,
 * classifies each finding as SURFACE or SUPPRESS, and returns
 * the structured response.
 *
 * If the ML service is unavailable, a deterministic fallback (overlap flag)
 * is used and ml_status is set to "UNAVAILABLE".
 */
router.post('/evaluate', async (req: Request, res: Response) => {
  const parsed = evaluateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      details: parsed.error.format(),
    });
    return;
  }

  try {
    const response = await evaluateReview(parsed.data, res.locals.requestId as string | undefined);
    res.status(200).json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message,
    });
  }
});

export default router;
