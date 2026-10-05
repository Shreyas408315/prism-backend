import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { surfaceFeatures } from './fixtures/surfaceFeatures.js';

// Mock mlClient so integration tests don't require the Python service
vi.mock('../src/services/mlClient.js', () => ({
  predictSingle: vi.fn(),
  predictBatch: vi.fn(),
  checkMlHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/repositories/reviewRepository.js', () => ({
  persistReviewEvaluation: vi.fn().mockResolvedValue(undefined),
}));

import { predictBatch, checkMlHealth } from '../src/services/mlClient.js';

const app = createApp();

// ─── /health ──────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with the required backend health contract', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      service: 'prism-backend',
    });
  });
});

// ─── POST /api/review/evaluate ────────────────────────────────────────────────

const VALID_BODY = {
  repository: 'org/repo',
  pull_request: 42,
  findings: [
    {
      finding_id: 'finding-1',
      file_path: 'src/index.js',
      features: surfaceFeatures,
    },
  ],
};

const ML_RESPONSE = {
  ok: true as const,
  data: {
    model_version: 'eslint-surface-hybrid-ensemble-v1',
    threshold: 0.505,
    predictions: [
      {
        probabilities: {
          random_forest: 0.5878,
          logistic_regression: 0.6384,
          xgboost: 0.5165,
        },
        ensemble_surface_probability: 0.5633,
        threshold: 0.505,
        decision: 'surface' as const,
      },
    ],
  },
};

describe('POST /api/review/evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(predictBatch).mockResolvedValue(ML_RESPONSE);
  });

  it('returns 422 for missing required fields', async () => {
    const res = await request(app).post('/api/review/evaluate').send({});
    expect(res.status).toBe(422);
  });

  it('returns 200 and ML prediction on success', async () => {
    const res = await request(app).post('/api/review/evaluate').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.ml_status).toBe('OK');
    expect(res.body.total_findings).toBe(1);
    expect(res.body.surface_count).toBe(1);
    expect(res.body.suppressed_count).toBe(0);
    expect(res.body.findings[0].decision).toBe('surface');
    expect(res.body.findings[0].decision_source).toBe('MODEL');
    expect(res.body.findings[0].ensemble_surface_probability).toBeCloseTo(0.5633, 4);
  });

  it.each([
    [1, 'surface'],
    [0, 'suppress'],
  ] as const)('uses overlap=%s for fallback', async (overlap, decision) => {
    vi.mocked(predictBatch).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'NETWORK', message: 'Connection refused' },
    });
    const features = { ...surfaceFeatures, finding_overlaps_change: overlap };
    const res = await request(app).post('/api/review/evaluate').send({
      ...VALID_BODY,
      findings: [{
        finding_id: 'finding-fallback',
        file_path: 'src/index.js',
        features,
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.ml_status).toBe('UNAVAILABLE');
    expect(res.body.findings[0].ml_status).toBe('UNAVAILABLE');
    expect(res.body.findings[0].decision_source).toBe('deterministic_fallback');
    expect(res.body.findings[0].decision).toBe(decision);
  });

  it('returns an empty findings array without calling ML', async () => {
    const res = await request(app).post('/api/review/evaluate').send({
      ...VALID_BODY,
      findings: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(0);
    expect(predictBatch).not.toHaveBeenCalled();
  });
});
