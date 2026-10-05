import { randomUUID } from 'node:crypto';
import { predictBatch, checkMlHealth } from './mlClient.js';
import { persistReviewEvaluation } from '../repositories/reviewRepository.js';
import type { SurfaceModelFeatures } from '../schemas/finding.js';
import type {
  EvaluatedFinding,
  ReviewEvaluationResponse,
} from '../schemas/mlResponse.js';

export interface ReviewEvaluationRequest {
  repository: string;
  pull_request: number | string;
  findings: Array<{
    features: SurfaceModelFeatures;
    finding_id?: string;
    file_path: string;
  }>;
}

function fallbackDecision(features: SurfaceModelFeatures): 'surface' | 'suppress' {
  return features.finding_overlaps_change === 1 ? 'surface' : 'suppress';
}

function makeFindingId(
  finding: ReviewEvaluationRequest['findings'][number],
): string {
  return finding.finding_id ??
    `${finding.file_path}:${finding.features.start_line}:${finding.features.rule_id}`;
}

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
        ensemble_surface_probability: finding.ensemble_surface_probability ?? null,
        decision: finding.decision,
        decision_source: finding.decision_source,
        latency_ms: Date.now() - startedAt,
      }));
    }
  };

  const persistEvaluation = async (
    response: ReviewEvaluationResponse,
    modelVersion?: {
      model_version: string;
      positive_class: string;
      threshold: number;
    },
  ) => {
    await persistReviewEvaluation({
      review: {
        id: response.review_id,
        repository: response.repository,
        pull_request: String(response.pull_request),
        ml_status: response.ml_status,
        total_findings: response.total_findings,
        surface_count: response.surface_count,
        suppressed_count: response.suppressed_count,
      },
      modelVersion: modelVersion ? {
        ...modelVersion,
        feature_count: 55,
        model_family: 'hybrid_ensemble',
      } : undefined,
      findings: response.findings.map((finding) => ({
        review_id: response.review_id,
        finding_id: finding.finding_id,
        rule_id: finding.rule_id,
        file_path: finding.file_path,
        start_line: finding.start_line,
        decision: finding.decision,
        decision_source: finding.decision_source,
        ml_status: finding.ml_status,
        ensemble_surface_probability: finding.ensemble_surface_probability,
        threshold: finding.threshold,
        model_version: finding.decision_source === 'MODEL' ? modelVersion?.model_version : null,
        probabilities: finding.probabilities,
        features: finding.features,
      })),
    });
  };

  if (request.findings.length === 0) {
    const response: ReviewEvaluationResponse = {
      review_id,
      repository: request.repository,
      pull_request: request.pull_request,
      ml_status: 'OK',
      total_findings: 0,
      surface_count: 0,
      suppressed_count: 0,
      findings: [],
      timestamp,
    };
    await persistEvaluation(response);
    return response;
  }

  const featureRows = request.findings.map(({ features }) => features);
  const mlResult = await predictBatch(featureRows);

  if (!mlResult.ok) {
    const evaluated: EvaluatedFinding[] = request.findings.map((finding) => ({
      finding_id: makeFindingId(finding),
      rule_id: finding.features.rule_id,
      file_path: finding.file_path,
      start_line: finding.features.start_line,
      decision: fallbackDecision(finding.features),
      decision_source: 'deterministic_fallback',
      ml_status: 'UNAVAILABLE',
      features: finding.features,
    }));
    logEvaluation(evaluated);

    const fallbackResponse: ReviewEvaluationResponse = {
      review_id,
      repository: request.repository,
      pull_request: request.pull_request,
      ml_status: 'UNAVAILABLE',
      total_findings: evaluated.length,
      surface_count: evaluated.filter((finding) => finding.decision === 'surface').length,
      suppressed_count: evaluated.filter((finding) => finding.decision === 'suppress').length,
      findings: evaluated,
      timestamp,
    };
    await persistEvaluation(fallbackResponse);
    return fallbackResponse;
  }

  const { predictions, threshold, model_version } = mlResult.data;
  const evaluated: EvaluatedFinding[] = request.findings.map((finding, index) => {
    const prediction = predictions[index];
    if (!prediction) {
      return {
        finding_id: makeFindingId(finding),
        rule_id: finding.features.rule_id,
        file_path: finding.file_path,
        start_line: finding.features.start_line,
        decision: fallbackDecision(finding.features),
        decision_source: 'deterministic_fallback',
        ml_status: 'UNAVAILABLE',
        features: finding.features,
      };
    }
    return {
      finding_id: makeFindingId(finding),
      rule_id: finding.features.rule_id,
      file_path: finding.file_path,
      start_line: finding.features.start_line,
      decision: prediction.decision,
      decision_source: 'MODEL',
      ml_status: 'OK',
      ensemble_surface_probability: prediction.ensemble_surface_probability,
      threshold,
      probabilities: prediction.probabilities,
      features: finding.features,
    };
  });
  logEvaluation(evaluated);

  const hasMissingPredictions = predictions.length < request.findings.length;
  const response: ReviewEvaluationResponse = {
    review_id,
    repository: request.repository,
    pull_request: request.pull_request,
    ml_status: hasMissingPredictions ? 'PARTIAL' : 'OK',
    total_findings: evaluated.length,
    surface_count: evaluated.filter((finding) => finding.decision === 'surface').length,
    suppressed_count: evaluated.filter((finding) => finding.decision === 'suppress').length,
    findings: evaluated,
    timestamp,
  };
  await persistEvaluation(response, {
    model_version,
    positive_class: 'surface',
    threshold,
  });
  return response;
}

export { checkMlHealth };
