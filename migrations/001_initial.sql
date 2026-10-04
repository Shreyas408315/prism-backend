CREATE TABLE reviews (
  id UUID PRIMARY KEY,
  repository TEXT NOT NULL,
  pull_request TEXT NOT NULL,
  ml_status TEXT NOT NULL,
  total_findings INTEGER NOT NULL,
  introduced_count INTEGER NOT NULL,
  pre_existing_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE findings (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  origin_decision TEXT NOT NULL,
  decision_source TEXT NOT NULL,
  ml_status TEXT NOT NULL,
  risk_score DOUBLE PRECISION NULL,
  threshold DOUBLE PRECISION NULL,
  model_version TEXT NULL,
  component_scores JSONB NULL,
  features JSONB NULL,
  raw_finding JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE model_versions (
  id UUID PRIMARY KEY,
  model_version TEXT UNIQUE NOT NULL,
  positive_class TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  feature_count INTEGER NOT NULL,
  model_family TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reviews_repository_pull_request_idx ON reviews(repository, pull_request);
CREATE INDEX findings_review_id_idx ON findings(review_id);
CREATE INDEX findings_origin_decision_idx ON findings(origin_decision);
CREATE INDEX findings_model_version_idx ON findings(model_version);