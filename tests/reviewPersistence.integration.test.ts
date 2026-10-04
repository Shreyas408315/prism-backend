import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDatabase, pool } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';

vi.mock('../src/services/mlClient.js', () => ({
  predictSingle: vi.fn(),
  predictBatch: vi.fn(),
  checkMlHealth: vi.fn().mockResolvedValue(true),
}));

import { predictBatch } from '../src/services/mlClient.js';

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const databaseTests = describe.skipIf(!databaseConfigured);
const app = createApp();
const reviewIds: string[] = [];
const MODEL_VERSION = 'prism-persistence-integration-v1';

const requestBody = {
  repository: 'org/prism-persistence-integration',
  pull_request: 42,
  findings: [{
    finding: {
      finding_id: 'canonical-finding',
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
      finding_overlaps_change: true,
    },
    context: {
      fileTotalLines: 200,
      changedLines: [9, 10, 11],
      prTotalFindingsInFile: 3,
      sameRuleFindingsInFile: 2,
      sameRuleFindingsInRepo: 5,
    },
  }],
};

const modelResult = {
  ok: true as const,
  data: {
    model_version: MODEL_VERSION,
    threshold: 0.574674670640332,
    predictions: [{
      model_version: MODEL_VERSION,
      positive_class: 'INTRODUCED' as const,
      risk_score: 0.8389374128352186,
      decision: 'INTRODUCED' as const,
      threshold: 0.574674670640332,
      component_scores: {
        random_forest: 0.87,
        logistic_regression: 0.7,
        xgboost: 0.93,
      },
    }],
  },
};

databaseTests('POST /api/review/evaluate persistence', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    for (const reviewId of reviewIds.splice(0)) {
      await pool.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
    }
    await pool.query('DELETE FROM model_versions WHERE model_version = $1', [MODEL_VERSION]);
  });

  afterAll(async () => {
    if (databaseConfigured) await closeDatabase();
  });

  it('persists one successful model review and its prediction without changing the API result', async () => {
    vi.mocked(predictBatch).mockResolvedValue(modelResult);

    const response = await request(app).post('/api/review/evaluate').send(requestBody);

    expect(response.status).toBe(200);
    expect(response.body.ml_status).toBe('OK');
    expect(response.body.findings).toHaveLength(1);
    expect(response.body.findings[0].origin_decision).toBe('INTRODUCED');
    expect(response.body.findings[0].decision_source).toBe('MODEL');
    reviewIds.push(response.body.review_id);

    const reviews = await pool.query('SELECT * FROM reviews WHERE id = $1', [response.body.review_id]);
    const findings = await pool.query('SELECT * FROM findings WHERE review_id = $1', [response.body.review_id]);
    const modelVersions = await pool.query(
      'SELECT * FROM model_versions WHERE model_version = $1',
      [MODEL_VERSION],
    );
    expect(reviews.rowCount).toBe(1);
    expect(findings.rowCount).toBe(1);
    expect(modelVersions.rowCount).toBe(1);
    expect(modelVersions.rows[0]).toMatchObject({
      positive_class: 'INTRODUCED',
      threshold: 0.574674670640332,
      feature_count: 22,
      model_family: 'ensemble',
    });
    expect(findings.rows[0]).toMatchObject({
      finding_id: 'canonical-finding',
      origin_decision: 'INTRODUCED',
      decision_source: 'MODEL',
      risk_score: 0.8389374128352186,
      model_version: MODEL_VERSION,
      component_scores: modelResult.data.predictions[0].component_scores,
    });
  });

  it('persists deterministic fallback findings with nullable model fields', async () => {
    vi.mocked(predictBatch).mockResolvedValue({
      ok: false,
      error: { kind: 'NETWORK', message: 'Connection refused' },
    });

    const response = await request(app).post('/api/review/evaluate').send(requestBody);

    expect(response.status).toBe(200);
    expect(response.body.ml_status).toBe('UNAVAILABLE');
    expect(response.body.findings[0].origin_decision).toBe('INTRODUCED');
    expect(response.body.findings[0].decision_source).toBe('deterministic_fallback');
    reviewIds.push(response.body.review_id);

    const reviews = await pool.query('SELECT * FROM reviews WHERE id = $1', [response.body.review_id]);
    const findings = await pool.query('SELECT * FROM findings WHERE review_id = $1', [response.body.review_id]);
    expect(reviews.rowCount).toBe(1);
    expect(findings.rowCount).toBe(1);
    expect(findings.rows[0]).toMatchObject({
      finding_id: 'canonical-finding',
      origin_decision: 'INTRODUCED',
      decision_source: 'deterministic_fallback',
      ml_status: 'UNAVAILABLE',
      risk_score: null,
      threshold: null,
      model_version: null,
      component_scores: null,
    });
    expect(findings.rows[0].raw_finding).toMatchObject({
      rule_id: 'no-unused-vars',
      finding_id: 'canonical-finding',
    });
  });
});