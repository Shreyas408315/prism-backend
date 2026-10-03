import { z } from 'zod';

/**
 * Exact 22-feature contract required by the PRism Python Origin Classification Service.
 * Matches model/prism_ensemble_clean.joblib and FastAPI schemas.py.
 */
export const originModelFeaturesSchema = z.object({
  rule_id: z.string().min(1, 'rule_id is required'),
  rule_family: z.string().min(1, 'rule_family is required'),
  severity: z.number().int().min(0).max(2),
  is_error: z.number().int().min(0).max(1),
  message_length: z.number().int().min(0),
  has_fix: z.number().int().min(0).max(1),
  fix_text_length: z.number().int().min(0),
  fix_range_length: z.number().int().min(0),
  has_suggestions: z.number().int().min(0).max(1),
  suggestion_count: z.number().int().min(0),
  changed_line_count: z.number().int().min(0),
  file_size_lines: z.number().int().min(1),
  start_line: z.number().int().min(1),
  finding_start_line_ratio: z.number().min(0).max(1),
  finding_span_lines: z.number().int().min(1),
  finding_span_columns: z.number().int().min(0),
  pr_change_code_lines: z.number().int().min(0),
  pr_total_findings_in_file: z.number().int().min(0),
  same_rule_findings_in_file: z.number().int().min(0),
  same_rule_findings_in_repo: z.number().int().min(0),
  finding_overlaps_change: z.number().int().min(0).max(1),
  finding_change_distance: z.number().int().min(0),
}).strict(); // Disallow arbitrary extra fields to prevent contract violations

export type OriginModelFeatures = z.infer<typeof originModelFeaturesSchema>;

/**
 * Raw finding schema representing a static analysis finding (e.g. from ESLint)
 * before feature engineering.
 */
export const rawFindingInputSchema = z.object({
  finding_id: z.string().optional(),
  file_path: z.string().min(1, 'file_path is required'),
  rule_id: z.string().min(1, 'rule_id is required'),
  severity: z.number().int().default(1),
  message: z.string().default(''),
  start_line: z.number().int().min(1).default(1),
  start_column: z.number().int().default(0),
  end_line: z.number().int().optional(),
  end_column: z.number().int().optional(),
  has_fix: z.boolean().default(false),
  fix_text: z.string().optional(),
  fix_range_start: z.number().int().optional(),
  fix_range_end: z.number().int().optional(),
  has_suggestions: z.boolean().default(false),
  suggestion_count: z.number().int().default(0),
  // Direct pre-computed feature overrides (optional, used if static analyzer already produced them)
  finding_overlaps_change: z.boolean().optional(),
  finding_change_distance: z.number().int().optional(),
  changed_line_count: z.number().int().optional(),
  pr_change_code_lines: z.number().int().optional(),
});

export type RawFindingInput = z.infer<typeof rawFindingInputSchema>;

/**
 * Context provided for feature construction (PR changed lines, file sizes, repo counts).
 */
export interface FeatureExtractionContext {
  fileTotalLines?: number;
  changedLines?: number[]; // List of line numbers modified in the PR for this file
  prTotalFindingsInFile?: number;
  sameRuleFindingsInFile?: number;
  sameRuleFindingsInRepo?: number;
  prChangeCodeLines?: number;
}
