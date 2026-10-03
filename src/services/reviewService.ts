import { randomUUID } from 'crypto';
import { buildOriginModelFeatures } from './featureBuilder.js';
import { predictBatch, checkMlHealth } from './mlClient.js';
import {
  type RawFindingInput,
  type FeatureExtractionContext,
} from '../schemas/finding.js';
import {
  type EvaluatedFinding,
  type ReviewEvaluationResponse,
} from '../schemas/mlResponse.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewEvaluationRequest {
  repository: string;
  pull_request: number | string;
  findings: Array<{
    finding: RawFindingInput;
    context?: FeatureExtractionContext;
  }>;
}

// ─── Deterministic fallback ───────────────────────────────────────────────────

function normalizeOverlapFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === '1';
  }
  return false;
}

/**
 * When the ML service is unavailable, use the overlap flag as a cheap proxy.
 * This MUST NOT change the model threshold or any model weight.
 */
function deterministicFallback(finding: RawFindingInput): EvaluatedFinding & {
  decisionSource: string;
  mlStatus: string;
} {
  const isOverlap = normalizeOverlapFlag(finding.finding_overlaps_change);
  const origin_decision = isOverlap ? 'INTRODUCED' : 'PRE_EXISTING';

  return {
    finding_id: finding.finding_id ?? `${finding.file_path}:${finding.start_line}:${finding.rule_id}`,
    rule_id: finding.rule_id,
    file_path: finding.file_path,
    start_line: finding.start_line,
    origin_decision,
    decision_source: 'deterministic_fallback',
    decisionSource: 'deterministic_fallback',
    ml_status: 'UNAVAILABLE',
    mlStatus: 'UNAVAILABLE',
  };
}

// ─── Main orchestration ───────────────────────────────────────────────────────

/**
 * Evaluate all findings in a PR using the ML origin-classification service.
 *
 * Flow:
 *  1. Build feature rows for every finding.
 *  2. Call POST /predict/batch in one round-trip.
 *  3. If ML is down, fall back to the deterministic overlap rule for all findings.
 *  4. Return a structured ReviewEvaluationResponse.
 */
export async function evaluateReview(
  request: ReviewEvaluationRequest,
  requestId?: string,
): Promise<ReviewEvaluationResponse> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const review_id = randomUUID();
  const logEvaluation = (findings: EvaluatedFinding[]) => {
    for (const finding of findings) {
      console.info(JSON.stringify({
        event: 'review_finding_evaluated',
        request_id: requestId ?? null,
        review_id,
        finding_id: finding.finding_id,
        ml_status: finding.ml_status,
        risk_score: finding.risk_score ?? null,
        decision: finding.origin_decision,
        decision_source: finding.decision_source,
        latency_ms: Date.now() - startedAt,
      }));
    }
  };

  if (request.findings.length === 0) {
    return {
      review_id,
      repository: request.repository,
      pull_request: request.pull_request,
      ml_status: 'OK',
      total_findings: 0,
      introduced_count: 0,
      pre_existing_count: 0,
      findings: [],
      timestamp,
    };
  }

  // ── Step 1: build features ──
  const featureRows = request.findings.map(({ finding, context }) =>
    buildOriginModelFeatures(finding, context),
  );

  // ── Step 2: call ML service ──
  const mlResult = await predictBatch(featureRows);

  // ── Step 3: handle ML failure ──
  if (!mlResult.ok) {
    const evaluated: EvaluatedFinding[] = request.findings.map(({ finding }) =>
      ({ ...deterministicFallback(finding), raw_finding: finding }),
    );
    logEvaluation(evaluated);

    const fallbackResponse: ReviewEvaluationResponse & { mlStatus: string } = {
      review_id,
      repository: request.repository,
      pull_request: request.pull_request,
      ml_status: 'UNAVAILABLE',
      mlStatus: 'UNAVAILABLE',
      total_findings: evaluated.length,
      introduced_count: evaluated.filter((f) => f.origin_decision === 'INTRODUCED').length,
      pre_existing_count: evaluated.filter((f) => f.origin_decision === 'PRE_EXISTING').length,
      findings: evaluated,
      timestamp,
    };

    return fallbackResponse;
  }

  // ── Step 4: map ML predictions back to findings ──
  const { predictions, threshold, model_version } = mlResult.data;
  const evaluated: EvaluatedFinding[] = request.findings.map(({ finding }, idx) => {
    const pred = predictions[idx];
    if (!pred) {
      return deterministicFallback(finding);
    }
    return {
      finding_id:
        finding.finding_id ??
        `${finding.file_path}:${finding.start_line}:${finding.rule_id}`,
      rule_id: finding.rule_id,
      file_path: finding.file_path,
      start_line: finding.start_line,
      origin_decision: pred.decision,
      decision_source: 'MODEL' as const,
      decisionSource: 'MODEL' as const,
      ml_status: 'OK' as const,
      mlStatus: 'OK' as const,
      risk_score: pred.risk_score,
      threshold,
      component_scores: pred.component_scores,
      features: featureRows[idx],
    };
  });
  logEvaluation(evaluated);

  const hasMissingPredictions = predictions.length < request.findings.length;

  const successResponse: ReviewEvaluationResponse & { mlStatus: string } = {
    review_id,
    repository: request.repository,
    pull_request: request.pull_request,
    ml_status: hasMissingPredictions ? 'PARTIAL' : 'OK',
    mlStatus: hasMissingPredictions ? 'PARTIAL' : 'OK',
    total_findings: evaluated.length,
    introduced_count: evaluated.filter((f) => f.origin_decision === 'INTRODUCED').length,
    pre_existing_count: evaluated.filter((f) => f.origin_decision === 'PRE_EXISTING').length,
    findings: evaluated,
    timestamp,
  };

  return successResponse;
}

// Re-export health check for convenience
export { checkMlHealth };
