import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { surfaceFeatures } from './fixtures/surfaceFeatures.js';

vi.mock('../src/services/mlClient.js', () => ({
  predictOrigin: vi.fn(),
  predictSingle: vi.fn(),
  predictOriginBatch: vi.fn(),
  predictBatch: vi.fn(),
  checkMlHealth: vi.fn().mockResolvedValue(true),
}));

import { predictSingle, predictBatch } from '../src/services/mlClient.js';

const app = createApp();
const prediction = {
  probabilities: {
    logistic_regression: 0.6384,
    random_forest: 0.5878,
    xgboost: 0.5165,
  },
  ensemble_surface_probability: 0.5633,
  threshold: 0.505,
  decision: 'surface' as const,
};

describe('POST /api/ml/predict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('proxies the 43-feature contract and validates the model response', async () => {
    vi.mocked(predictSingle).mockResolvedValue({ ok: true, data: prediction });

    const response = await request(app).post('/api/ml/predict').send(surfaceFeatures);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(prediction);
    expect(predictSingle).toHaveBeenCalledWith(surfaceFeatures);
  });

  it('rejects the previous 22-feature contract', async () => {
    const response = await request(app).post('/api/ml/predict').send({
      rule_id: 'no-unused-vars',
      rule_family: 'possible-problems',
      severity: 2,
    });
    expect(response.status).toBe(422);
  });
});

describe('POST /api/ml/predict/batch', () => {
  it('forwards 43-feature rows to the ML service', async () => {
    vi.mocked(predictBatch).mockResolvedValue({
      ok: true,
      data: {
        model_version: 'eslint-surface-hybrid-ensemble-v1',
        threshold: 0.505,
        predictions: [prediction],
      },
    });

    const response = await request(app)
      .post('/api/ml/predict/batch')
      .send({ findings: [surfaceFeatures] });
    expect(response.status).toBe(200);
    expect(response.body.predictions).toEqual([prediction]);
    expect(predictBatch).toHaveBeenCalledWith([surfaceFeatures]);
  });
});
