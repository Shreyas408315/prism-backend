import { env } from '../config/env.js';
import type { OriginModelFeatures } from '../schemas/finding.js';
import {
  predictionResultSchema,
  batchPredictionResponseSchema,
  type PredictionResult,
  type BatchPredictionResponse,
} from '../schemas/mlResponse.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MlClientError =
  | { kind: 'TIMEOUT'; message: string }
  | { kind: 'NETWORK'; message: string }
  | { kind: 'HTTP'; status: number; message: string }
  | { kind: 'VALIDATION'; message: string };

export type MlResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: MlClientError };

// ─── Internals ────────────────────────────────────────────────────────────────

const BASE_URL = env.ML_SERVICE_URL.replace(/\/$/, '');
const TIMEOUT_MS = env.ML_SERVICE_TIMEOUT_MS;

/**
 * POST to the ML service with an AbortController-based timeout.
 * Never throws — returns a typed MlResult discriminated union.
 */
async function mlPost<T>(
  path: string,
  body: unknown,
  parseResponse: (raw: unknown) => T,
): Promise<MlResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: { kind: 'HTTP', status: response.status, message: text },
      };
    }

    const raw: unknown = await response.json();
    try {
      const data = parseResponse(raw);
      return { ok: true, data };
    } catch (err: unknown) {
      return {
        ok: false,
        error: {
          kind: 'VALIDATION',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  } catch (err: unknown) {
    clearTimeout(timer);

    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: { kind: 'TIMEOUT', message: `ML service timed out after ${TIMEOUT_MS}ms` },
      };
    }
    return {
      ok: false,
      error: {
        kind: 'NETWORK',
        message: err instanceof Error ? err.message : 'Unknown network error',
      },
    };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call POST /predict with a single feature row.
 * Returns the full PredictionResult or a typed error.
 */
export async function predictOrigin(
  features: OriginModelFeatures,
): Promise<MlResult<PredictionResult>> {
  return mlPost(
    '/predict',
    features,
    (raw) => {
      const parsed = predictionResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`ML /predict validation failed: ${JSON.stringify(parsed.error.format())}`);
      }
      return parsed.data;
    },
  );
}

export const predictSingle = predictOrigin;

/**
 * Call POST /predict/batch with an array of feature rows.
 * Returns a BatchPredictionResponse or a typed error.
 *
 * The Python service expects the payload as:
 *   { "items": [ <feature_row>, ... ] }
 */
export async function predictOriginBatch(
  featureRows: OriginModelFeatures[],
): Promise<MlResult<BatchPredictionResponse>> {
  return mlPost(
    '/predict/batch',
    { items: featureRows },
    (raw) => {
      const parsed = batchPredictionResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `ML /predict/batch validation failed: ${JSON.stringify(parsed.error.format())}`,
        );
      }
      return parsed.data;
    },
  );
}

export const predictBatch = predictOriginBatch;

/**
 * Lightweight health check — returns true if the ML service is reachable.
 */
export async function checkMlHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}
