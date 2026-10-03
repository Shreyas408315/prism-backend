import { z } from 'zod';
import { originModelFeaturesSchema, rawFindingInputSchema } from './finding.js';

/**
 * Validation schema for the response from POST /predict.
 * Strictly verifies types and bounds.
 */
export const predictionResultSchema = z.object({
  model_version: z.string().min(1),
  positive_class: z.literal('INTRODUCED'),
  risk_score: z.number().min(0).max(1),
  decision: z.enum(['INTRODUCED', 'PRE_EXISTING']),
  threshold: z.number(),
  component_scores: z.object({
    random_forest: z.number().min(0).max(1),
    logistic_regression: z.number().min(0).max(1),
    xgboost: z.number().min(0).max(1),
  }).catchall(z.number()),
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
  origin_decision: z.enum(['INTRODUCED', 'PRE_EXISTING']),
  decision_source: z.enum(['MODEL', 'deterministic_fallback']),
  ml_status: z.enum(['OK', 'UNAVAILABLE', 'ERROR']),
  risk_score: z.number().min(0).max(1).optional(),
  threshold: z.number().optional(),
  component_scores: z.record(z.string(), z.number()).optional(),
  features: originModelFeaturesSchema.optional(),
  raw_finding: rawFindingInputSchema.optional(),
  error: z.string().optional(),
});

export type EvaluatedFinding = z.infer<typeof evaluatedFindingSchema>;

export const reviewEvaluationResponseSchema = z.object({
  review_id: z.string().uuid(),
  repository: z.string(),
  pull_request: z.union([z.number(), z.string()]),
  ml_status: z.enum(['OK', 'UNAVAILABLE', 'PARTIAL', 'ERROR']),
  total_findings: z.number().int().min(0),
  introduced_count: z.number().int().min(0),
  pre_existing_count: z.number().int().min(0),
  findings: z.array(evaluatedFindingSchema),
  timestamp: z.string(),
});

export type ReviewEvaluationResponse = z.infer<typeof reviewEvaluationResponseSchema>;
