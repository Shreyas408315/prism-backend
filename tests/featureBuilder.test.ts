import { describe, it, expect } from 'vitest';
import {
  buildOriginModelFeatures,
  getRuleFamily,
  computeOverlapAndDistance,
} from '../src/services/featureBuilder.js';
import type { RawFindingInput } from '../src/schemas/finding.js';

// ─── Canonical smoke-test row ─────────────────────────────────────────────────
// Based on the exact row used for direct artifact inference (risk_score ≈ 0.839)
// from eslint_ml_features_introduced_v1.csv
const CANONICAL_FINDING: RawFindingInput = {
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
};

const CANONICAL_CONTEXT = {
  fileTotalLines: 200,
  changedLines: [8, 9, 10, 11, 12],
  prTotalFindingsInFile: 3,
  sameRuleFindingsInFile: 2,
  sameRuleFindingsInRepo: 5,
};

// ─── getRuleFamily ────────────────────────────────────────────────────────────

describe('getRuleFamily', () => {
  it('classifies no-unused-vars as possible-problems', () => {
    expect(getRuleFamily('no-unused-vars')).toBe('possible-problems');
  });

  it('classifies prefer-const as suggestions', () => {
    expect(getRuleFamily('prefer-const')).toBe('suggestions');
  });

  it('classifies semi as layout-formatting', () => {
    expect(getRuleFamily('semi')).toBe('layout-formatting');
  });

  it('returns unknown for unrecognised rules', () => {
    expect(getRuleFamily('react/jsx-no-target-blank')).toBe('unknown');
  });
});

// ─── computeOverlapAndDistance ────────────────────────────────────────────────

describe('computeOverlapAndDistance', () => {
  it('detects overlap when finding line is in changed lines', () => {
    const result = computeOverlapAndDistance(10, 10, [9, 10, 11]);
    expect(result.finding_overlaps_change).toBe(1);
    expect(result.finding_change_distance).toBe(0);
  });

  it('computes distance when no overlap', () => {
    const result = computeOverlapAndDistance(20, 22, [10, 11]);
    expect(result.finding_overlaps_change).toBe(0);
    // Distance from 20 to 11 = 9
    expect(result.finding_change_distance).toBe(9);
  });

  it('returns 0 distance when no changed lines', () => {
    const result = computeOverlapAndDistance(5, 5, []);
    expect(result.finding_overlaps_change).toBe(0);
    expect(result.finding_change_distance).toBe(0);
  });
});

// ─── buildOriginModelFeatures ─────────────────────────────────────────────────

describe('buildOriginModelFeatures', () => {
  it('produces exactly 22 features for the canonical row', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(Object.keys(features)).toHaveLength(22);
  });

  it('correctly sets is_error=1 for severity 2', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.is_error).toBe(1);
  });

  it('correctly sets finding_overlaps_change=1 when start_line is in changedLines', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.finding_overlaps_change).toBe(1);
    expect(features.finding_change_distance).toBe(0);
  });

  it('sets finding_overlaps_change=0 when no overlap', () => {
    const features = buildOriginModelFeatures(
      { ...CANONICAL_FINDING, start_line: 100, end_line: 100 },
      { ...CANONICAL_CONTEXT, changedLines: [1, 2, 3] },
    );
    expect(features.finding_overlaps_change).toBe(0);
    expect(features.finding_change_distance).toBeGreaterThan(0);
  });

  it('sets rule_family correctly', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.rule_family).toBe('possible-problems');
  });

  it('computes finding_start_line_ratio correctly', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.finding_start_line_ratio).toBeCloseTo(10 / 200, 5);
  });

  it('computes message_length correctly', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.message_length).toBe(CANONICAL_FINDING.message.length);
  });

  it('sets has_fix=0 when no fix', () => {
    const features = buildOriginModelFeatures(CANONICAL_FINDING, CANONICAL_CONTEXT);
    expect(features.has_fix).toBe(0);
  });

  it('sets has_fix=1 when fix present', () => {
    const features = buildOriginModelFeatures(
      { ...CANONICAL_FINDING, has_fix: true, fix_text: "let y = 1;" },
      CANONICAL_CONTEXT,
    );
    expect(features.has_fix).toBe(1);
    expect(features.fix_text_length).toBeGreaterThan(0);
  });

  it('throws if required fields produce invalid features', () => {
    // Empty rule_id fails the min(1) validation
    expect(() =>
      buildOriginModelFeatures(
        { ...CANONICAL_FINDING, rule_id: '' },
        CANONICAL_CONTEXT,
      ),
    ).toThrow();
  });
});
