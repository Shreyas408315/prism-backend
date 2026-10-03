import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rawFindingInputSchema } from '../schemas/finding.js';
import { evaluateReview } from '../services/reviewService.js';

const router = Router();

// ─── Request schema ───────────────────────────────────────────────────────────

const contextSchema = z.object({
  fileTotalLines: z.number().int().positive().optional(),
  changedLines: z.array(z.number().int().min(1)).optional(),
  prTotalFindingsInFile: z.number().int().min(0).optional(),
  sameRuleFindingsInFile: z.number().int().min(0).optional(),
  sameRuleFindingsInRepo: z.number().int().min(0).optional(),
  prChangeCodeLines: z.number().int().min(0).optional(),
}).optional();

const findingWithContextSchema = z.object({
  finding: rawFindingInputSchema,
  context: contextSchema,
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
 * Accepts raw ESLint findings + PR context, builds 22-feature rows,
 * classifies each finding as INTRODUCED or PRE_EXISTING, and returns
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
