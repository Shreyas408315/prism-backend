import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

// Mock mlClient so integration tests don't require the Python service
vi.mock('../src/services/mlClient.js', () => ({
  predictSingle: vi.fn(),
  predictBatch: vi.fn(),
  checkMlHealth: vi.fn().mockResolvedValue(true),
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
      finding: {
        rule_id: 'no-unused-vars',
        severity: 2,
        message: "'x' is defined but never used",
        start_line: 10,
        start_column: 4,
        end_line: 10,
        end_column: 5,
        has_fix: false,
        has_suggestions: false,
        suggestion_count: 0,
        file_path: 'src/index.ts',
      },
      context: {
        fileTotalLines: 200,
        changedLines: [9, 10, 11],
        prTotalFindingsInFile: 3,
        sameRuleFindingsInFile: 2,
        sameRuleFindingsInRepo: 5,
      },
    },
  ],
};

const ML_RESPONSE = {
  ok: true as const,
  data: {
    model_version: 'prism-origin-ensemble-clean-v1',
    threshold: 0.574674670640332,
    predictions: [
      {
        model_version: 'prism-origin-ensemble-clean-v1',
        positive_class: 'INTRODUCED' as const,
        risk_score: 0.838937,
        decision: 'INTRODUCED' as const,
        threshold: 0.574674670640332,
        component_scores: {
          random_forest: 0.9,
          logistic_regression: 0.82,
          xgboost: 0.81,
        },
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
    expect(res.body.introduced_count).toBe(1);
    expect(res.body.findings[0].origin_decision).toBe('INTRODUCED');
    expect(res.body.findings[0].decision_source).toBe('MODEL');
    expect(res.body.findings[0].risk_score).toBeCloseTo(0.838937, 4);
  });

  it.each([
    [1, 'INTRODUCED'],
    [0, 'PRE_EXISTING'],
  ] as const)('uses overlap=%s for fallback and preserves the raw finding', async (overlap, decision) => {
    vi.mocked(predictBatch).mockResolvedValueOnce({
      ok: false,
      error: { kind: 'NETWORK', message: 'Connection refused' },
    });
    const finding = {
      ...VALID_BODY.findings[0].finding,
      finding_overlaps_change: overlap === 1,
    };
    const res = await request(app).post('/api/review/evaluate').send({
      ...VALID_BODY,
      findings: [{ finding, context: VALID_BODY.findings[0].context }],
    });

    expect(res.status).toBe(200);
    expect(res.body.ml_status).toBe('UNAVAILABLE');
    expect(res.body.findings[0].ml_status).toBe('UNAVAILABLE');
    expect(res.body.findings[0].decision_source).toBe('deterministic_fallback');
    expect(res.body.findings[0].origin_decision).toBe(decision);
    expect(res.body.findings[0].raw_finding).toMatchObject({
      rule_id: 'no-unused-vars',
      message: "'x' is defined but never used",
      finding_overlaps_change: overlap === 1,
    });
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
