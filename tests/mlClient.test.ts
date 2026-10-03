import { describe, it, expect, vi, afterEach } from 'vitest';
import { predictOrigin, predictOriginBatch } from '../src/services/mlClient.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mlClient', () => {
  it('validates a successful prediction response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
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
        }),
      }),
    );

    const result = await predictOrigin({
      rule_id: 'no-unused-vars',
      rule_family: 'possible-problems',
      severity: 2,
      is_error: 1,
      message_length: 30,
      has_fix: 0,
      fix_text_length: 0,
      fix_range_length: 0,
      has_suggestions: 0,
      suggestion_count: 0,
      changed_line_count: 1,
      file_size_lines: 50,
      start_line: 5,
      finding_start_line_ratio: 0.1,
      finding_span_lines: 1,
      finding_span_columns: 1,
      pr_change_code_lines: 1,
      pr_total_findings_in_file: 1,
      same_rule_findings_in_file: 1,
      same_rule_findings_in_repo: 1,
      finding_overlaps_change: 1,
      finding_change_distance: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.decision).toBe('INTRODUCED');
    }
  });

  it(
    'returns a timeout error when the ML service hangs',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url, init) => {
          const signal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          });
        }),
      );

      const result = await predictOriginBatch([]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('TIMEOUT');
      }
    },
    15000,
  );
});
