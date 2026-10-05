import { z } from 'zod';
import { surfaceModelFeaturesSchema } from './finding.js';

/**
 * Validation schema for the response from POST /predict.
 * Strictly verifies types and bounds.
 */
export const predictionResultSchema = z.object({
  probabilities: z.object({
    random_forest: z.number().min(0).max(1),
    logistic_regression: z.number().min(0).max(1),
    xgboost: z.number().min(0).max(1),
  }),
  ensemble_surface_probability: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  decision: z.enum(['surface', 'suppress']),
});

export type PredictionResult = z.infer<typeof predictionResultSchema>;

export const batchPredictionResponseSchema = z.object({
  model_version: z.string().min(1),
  threshold: z.number(),
  predictions: z.array(predictionResultSchema),
});

export type BatchPredictionResponse = z.infer<typeof batchPredictionResponseSchema>;

/**
 * Orchestrated Finding Response for the PRism pipeline.
 */
export const evaluatedFindingSchema = z.object({
  finding_id: z.string(),
  rule_id: z.string(),
  file_path: z.string(),
  start_line: z.number(),
  decision: z.enum(['surface', 'suppress']),
  decision_source: z.enum(['MODEL', 'deterministic_fallback']),
  ml_status: z.enum(['OK', 'UNAVAILABLE', 'ERROR']),
  ensemble_surface_probability: z.number().min(0).max(1).optional(),
  threshold: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
  features: surfaceModelFeaturesSchema.optional(),
  error: z.string().optional(),
});

export type EvaluatedFinding = z.infer<typeof evaluatedFindingSchema>;

export const reviewEvaluationResponseSchema = z.object({
  review_id: z.string().uuid(),
  repository: z.string(),
  pull_request: z.union([z.number(), z.string()]),
  ml_status: z.enum(['OK', 'UNAVAILABLE', 'PARTIAL', 'ERROR']),
  total_findings: z.number().int().min(0),
  surface_count: z.number().int().min(0),
  suppressed_count: z.number().int().min(0),
  findings: z.array(evaluatedFindingSchema),
  timestamp: z.string(),
});

export type ReviewEvaluationResponse = z.infer<typeof reviewEvaluationResponseSchema>;
