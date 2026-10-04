import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/database.js';

export interface ReviewRecord {
  id: string;
  repository: string;
  pull_request: string;
  ml_status: string;
  total_findings: number;
  introduced_count: number;
  pre_existing_count: number;
}

export interface FindingRecord {
  review_id: string;
  finding_id: string;
  rule_id: string;
  file_path: string;
  start_line: number;
  origin_decision: string;
  decision_source: string;
  ml_status: string;
  risk_score?: number | null;
  threshold?: number | null;
  model_version?: string | null;
  component_scores?: Record<string, number> | null;
  features?: unknown;
  raw_finding?: unknown;
}

export interface ModelVersionRecord {
  model_version: string;
  positive_class: string;
  threshold: number;
  feature_count: number;
  model_family: string;
}

export interface ReviewPersistenceInput {
  review: ReviewRecord;
  findings: FindingRecord[];
  modelVersion?: ModelVersionRecord;
}

function jsonValue(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

export async function createReview(client: PoolClient, review: ReviewRecord): Promise<void> {
  await client.query(
    `INSERT INTO reviews
      (id, repository, pull_request, ml_status, total_findings, introduced_count, pre_existing_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      review.id,
      review.repository,
      review.pull_request,
      review.ml_status,
      review.total_findings,
      review.introduced_count,
      review.pre_existing_count,
    ],
  );
}

export async function createFindings(
  client: PoolClient,
  findings: FindingRecord[],
): Promise<void> {
  for (const finding of findings) {
    await client.query(
      `INSERT INTO findings
        (id, review_id, finding_id, rule_id, file_path, start_line, origin_decision,
         decision_source, ml_status, risk_score, threshold, model_version,
         component_scores, features, raw_finding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb)`,
      [
        randomUUID(),
        finding.review_id,
        finding.finding_id,
        finding.rule_id,
        finding.file_path,
        finding.start_line,
        finding.origin_decision,
        finding.decision_source,
        finding.ml_status,
        finding.risk_score ?? null,
        finding.threshold ?? null,
        finding.model_version ?? null,
        jsonValue(finding.component_scores),
        jsonValue(finding.features),
        jsonValue(finding.raw_finding),
      ],
    );
  }
}

export async function ensureModelVersion(
  client: PoolClient,
  model: ModelVersionRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO model_versions
      (id, model_version, positive_class, threshold, feature_count, model_family)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (model_version) DO UPDATE SET
       positive_class = EXCLUDED.positive_class,
       threshold = EXCLUDED.threshold,
       feature_count = EXCLUDED.feature_count,
       model_family = EXCLUDED.model_family`,
    [
      randomUUID(),
      model.model_version,
      model.positive_class,
      model.threshold,
      model.feature_count,
      model.model_family,
    ],
  );
}

export async function persistReviewEvaluation(input: ReviewPersistenceInput): Promise<void> {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    if (input.modelVersion) await ensureModelVersion(client, input.modelVersion);
    await createReview(client, input.review);
    await createFindings(client, input.findings);
    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}