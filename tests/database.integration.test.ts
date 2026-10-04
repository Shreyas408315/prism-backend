import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, pool } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';
import {
  createFindings,
  createReview,
  ensureModelVersion,
  persistReviewEvaluation,
  type FindingRecord,
  type ModelVersionRecord,
  type ReviewRecord,
} from '../src/repositories/reviewRepository.js';

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const databaseTests = describe.skipIf(!databaseConfigured);
const reviewIds: string[] = [];
const modelVersions: string[] = [];

databaseTests('PostgreSQL repository', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    for (const reviewId of reviewIds.splice(0)) {
      await pool.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
    }
    for (const modelVersion of modelVersions.splice(0)) {
      await pool.query('DELETE FROM model_versions WHERE model_version = $1', [modelVersion]);
    }
  });

  afterAll(async () => {
    if (databaseConfigured) await closeDatabase();
  });

  it('applies migrations and creates all required tables', async () => {
    await runMigrations();
    const tables = await pool.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.schema_migrations') AS table_name
       UNION ALL SELECT to_regclass('public.reviews')
       UNION ALL SELECT to_regclass('public.findings')
       UNION ALL SELECT to_regclass('public.model_versions')`,
    );
    expect(tables.rows.every((row) => row.table_name !== null)).toBe(true);

    const applied = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      ['001_initial.sql'],
    );
    expect(applied.rowCount).toBe(1);
  });

  it('inserts a review and finding, stores JSONB, and upserts model metadata', async () => {
    const reviewId = randomUUID();
    const modelVersion = `test-${randomUUID()}`;
    reviewIds.push(reviewId);
    modelVersions.push(modelVersion);

    const review: ReviewRecord = {
      id: reviewId,
      repository: 'org/repo',
      pull_request: '42',
      ml_status: 'OK',
      total_findings: 1,
      introduced_count: 1,
      pre_existing_count: 0,
    };
    const metadata: ModelVersionRecord = {
      model_version: modelVersion,
      positive_class: 'INTRODUCED',
      threshold: 0.574674670640332,
      feature_count: 22,
      model_family: 'ensemble',
    };
    const finding: FindingRecord = {
      review_id: reviewId,
      finding_id: 'finding-1',
      rule_id: 'no-unused-vars',
      file_path: 'src/index.ts',
      start_line: 10,
      origin_decision: 'INTRODUCED',
      decision_source: 'MODEL',
      ml_status: 'OK',
      risk_score: 0.8389374128352186,
      threshold: metadata.threshold,
      model_version: modelVersion,
      component_scores: { random_forest: 0.87 },
      features: { finding_overlaps_change: 1 },
      raw_finding: { message: 'unused variable' },
    };

    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await createReview(client, review);
      await ensureModelVersion(client, metadata);
      await ensureModelVersion(client, { ...metadata, threshold: 0.6 });
      await createFindings(client, [finding]);

      const insertedReview = await client.query(
        'SELECT * FROM reviews WHERE id = $1',
        [reviewId],
      );
      const insertedFinding = await client.query(
        'SELECT * FROM findings WHERE review_id = $1',
        [reviewId],
      );
      const insertedModel = await client.query(
        'SELECT * FROM model_versions WHERE model_version = $1',
        [modelVersion],
      );

      expect(insertedReview.rowCount).toBe(1);
      expect(insertedFinding.rowCount).toBe(1);
      expect(insertedFinding.rows[0]).toMatchObject({
        origin_decision: 'INTRODUCED',
        decision_source: 'MODEL',
        risk_score: finding.risk_score,
        component_scores: finding.component_scores,
        features: finding.features,
        raw_finding: finding.raw_finding,
      });
      expect(insertedModel.rowCount).toBe(1);
      expect(insertedModel.rows[0].threshold).toBe(0.6);
      await client.query('COMMIT');
      committed = true;
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('enforces the finding-to-review foreign key', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(createFindings(client, [{
        review_id: randomUUID(),
        finding_id: 'orphan',
        rule_id: 'no-unused-vars',
        file_path: 'src/index.ts',
        start_line: 1,
        origin_decision: 'INTRODUCED',
        decision_source: 'MODEL',
        ml_status: 'OK',
      }])).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rolls back a review when its finding insert fails', async () => {
    const reviewId = randomUUID();
    reviewIds.push(reviewId);

    await expect(persistReviewEvaluation({
      review: {
        id: reviewId,
        repository: 'org/repo',
        pull_request: 'rollback-test',
        ml_status: 'OK',
        total_findings: 1,
        introduced_count: 1,
        pre_existing_count: 0,
      },
      findings: [{
        review_id: randomUUID(),
        finding_id: 'orphan',
        rule_id: 'no-unused-vars',
        file_path: 'src/index.ts',
        start_line: 1,
        origin_decision: 'INTRODUCED',
        decision_source: 'MODEL',
        ml_status: 'OK',
      }],
    })).rejects.toMatchObject({ code: '23503' });

    const insertedReview = await pool.query('SELECT id FROM reviews WHERE id = $1', [reviewId]);
    expect(insertedReview.rowCount).toBe(0);
  });
});