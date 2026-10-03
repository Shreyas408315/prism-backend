import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

vi.mock('../src/services/mlClient.js', () => ({
  predictOrigin: vi.fn(),
  predictSingle: vi.fn(),
  predictOriginBatch: vi.fn(),
  predictBatch: vi.fn(),
  checkMlHealth: vi.fn().mockResolvedValue(true),
}));

import { predictSingle, predictBatch } from '../src/services/mlClient.js';

const app = createApp();

const validFeatures = {
  rule_id: 'no-unused-vars',
  rule_family: 'possible-problems',
  severity: 2,
  is_error: 1,
  message_length: 46,
  has_fix: 0,
  fix_text_length: 0,
  fix_range_length: 0,
  has_suggestions: 0,
  suggestion_count: 0,
  changed_line_count: 3,
  file_size_lines: 200,
  start_line: 10,
  finding_start_line_ratio: 0.05,
  finding_span_lines: 1,
  finding_span_columns: 1,
  pr_change_code_lines: 1,
  pr_total_findings_in_file: 3,
  same_rule_findings_in_file: 2,
  same_rule_findings_in_repo: 5,
  finding_overlaps_change: 1,
  finding_change_distance: 0,
};

describe('POST /api/ml/predict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a validated ML prediction for a valid feature row', async () => {
    vi.mocked(predictSingle).mockResolvedValue({
      ok: true,
      data: {
        model_version: 'prism-origin-ensemble-clean-v1',
        positive_class: 'INTRODUCED',
        risk_score: 0.838937,
        decision: 'INTRODUCED',
        threshold: 0.574674670640332,
        component_scores: {
          random_forest: 0.87,
          logistic_regression: 0.7,
          xgboost: 0.93,
        },
      },
    });

    const res = await request(app).post('/api/ml/predict').send(validFeatures);

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('INTRODUCED');
    expect(res.body.risk_score).toBeCloseTo(0.838937, 5);
  });

  it('rejects invalid feature payloads', async () => {
    const res = await request(app).post('/api/ml/predict').send({ rule_id: '' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/ml/predict/batch', () => {
  it('forwards a batch request to the ML service', async () => {
    vi.mocked(predictBatch).mockResolvedValue({
      ok: true,
      data: {
        model_version: 'prism-origin-ensemble-clean-v1',
        threshold: 0.574674670640332,
        predictions: [
          {
            model_version: 'prism-origin-ensemble-clean-v1',
            positive_class: 'INTRODUCED',
            risk_score: 0.838937,
            decision: 'INTRODUCED',
            threshold: 0.574674670640332,
            component_scores: {
              random_forest: 0.87,
              logistic_regression: 0.7,
              xgboost: 0.93,
            },
          },
        ],
      },
    });

    const res = await request(app).post('/api/ml/predict/batch').send({ findings: [validFeatures] });
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(1);
  });
});
