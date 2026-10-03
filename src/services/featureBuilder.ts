import {
  type OriginModelFeatures,
  type RawFindingInput,
  type FeatureExtractionContext,
  originModelFeaturesSchema,
} from '../schemas/finding.js';

/**
 * ESLint rule family mapping — mirrors the Python feature engineering script.
 * This MUST stay in sync with build_eslint_features.mjs and the trained model.
 */
const POSSIBLE_PROBLEMS = new Set([
  'no-unused-vars', 'no-undef', 'no-unreachable', 'no-constant-binary-expression',
  'no-constant-condition', 'no-dupe-else-if', 'no-duplicate-case', 'no-fallthrough',
  'no-inner-declarations', 'no-irregular-whitespace', 'no-loss-of-precision', 'no-obj-calls',
  'no-promise-executor-return', 'no-prototype-builtins', 'no-self-assign', 'no-self-compare',
  'no-setter-return', 'no-sparse-arrays', 'no-unmodified-loop-condition',
  'no-unexpected-multiline', 'no-unsafe-finally', 'no-unsafe-negation',
  'no-unsafe-optional-chaining', 'no-useless-assignment', 'no-useless-catch',
]);

const SUGGESTIONS = new Set([
  'no-useless-constructor', 'no-useless-rename', 'no-var', 'prefer-const', 'prefer-template',
  'object-shorthand', 'prefer-arrow-callback', 'eqeqeq', 'no-console', 'no-debugger',
  'no-alert', 'no-array-constructor', 'no-new-object', 'no-new-wrappers', 'no-throw-literal',
  'no-return-assign', 'no-sequences', 'no-unneeded-ternary', 'no-useless-call',
  'no-useless-concat', 'no-useless-escape', 'no-useless-return',
]);

const LAYOUT_FORMATTING = new Set([
  'no-whitespace-before-property', 'comma-dangle', 'comma-spacing', 'key-spacing',
  'keyword-spacing', 'space-infix-ops', 'space-unary-ops', 'quotes', 'semi',
]);

/**
 * Determine the rule family for a given ESLint rule ID.
 * Mirrors the Python ruleFamily() function in build_eslint_features.mjs.
 */
export function getRuleFamily(ruleId: string): string {
  if (POSSIBLE_PROBLEMS.has(ruleId)) return 'possible-problems';
  if (SUGGESTIONS.has(ruleId)) return 'suggestions';
  if (LAYOUT_FORMATTING.has(ruleId)) return 'layout-formatting';
  return 'unknown';
}

/**
 * Compute whether a finding overlaps with PR changed lines, and the minimum
 * distance to the nearest changed line if it does not overlap.
 */
export function computeOverlapAndDistance(
  findingStartLine: number,
  findingEndLine: number,
  changedLines: number[],
): { finding_overlaps_change: 0 | 1; finding_change_distance: number } {
  if (changedLines.length === 0) {
    return { finding_overlaps_change: 0, finding_change_distance: 0 };
  }

  const changedSet = new Set(changedLines);
  // Check overlap: any finding line is a changed line
  for (let l = findingStartLine; l <= findingEndLine; l++) {
    if (changedSet.has(l)) {
      return { finding_overlaps_change: 1, finding_change_distance: 0 };
    }
  }

  // No overlap: compute minimum distance from finding to any changed line
  let minDist = Infinity;
  for (const cl of changedLines) {
    const distToStart = Math.abs(cl - findingStartLine);
    const distToEnd = Math.abs(cl - findingEndLine);
    minDist = Math.min(minDist, distToStart, distToEnd);
  }
  return {
    finding_overlaps_change: 0,
    finding_change_distance: Number.isFinite(minDist) ? minDist : 0,
  };
}

/**
 * Build the exact 22-feature contract required by the PRism origin classification model.
 *
 * This is the ONLY canonical location for feature construction.
 * Do NOT construct ML features anywhere else in the codebase.
 *
 * @param finding  - The raw static analysis finding (e.g., from ESLint)
 * @param context  - PR context (changed lines, file counts, repo-level counts)
 * @returns        OriginModelFeatures — the validated 22-feature object
 */
export function buildOriginModelFeatures(
  finding: RawFindingInput,
  context: FeatureExtractionContext = {},
): OriginModelFeatures {
  const {
    fileTotalLines = 100,
    changedLines = [],
    prTotalFindingsInFile = 1,
    sameRuleFindingsInFile = 1,
    sameRuleFindingsInRepo = 1,
    prChangeCodeLines,
  } = context;

  const startLine = Math.max(1, finding.start_line);
  const endLine = Math.max(startLine, finding.end_line ?? startLine);
  const fileSizeLines = Math.max(1, fileTotalLines);

  // finding_start_line_ratio: position of finding start relative to file length
  const findingStartLineRatio = startLine / fileSizeLines;

  // finding_span_lines: number of source lines the finding covers
  const findingSpanLines = Math.max(1, endLine - startLine + 1);

  // finding_span_columns: width in columns
  const findingSpanColumns = Math.max(
    0,
    (finding.end_column ?? finding.start_column) - finding.start_column,
  );

  // fix_range_length: length of the code region covered by the autofix
  const fixRangeLength =
    finding.fix_range_start != null && finding.fix_range_end != null
      ? Math.max(0, finding.fix_range_end - finding.fix_range_start)
      : 0;

  // pr_change_code_lines: number of changed lines within the finding's line span
  const computedPrChangeCodeLines =
    prChangeCodeLines ??
    changedLines.filter((l) => l >= startLine && l <= endLine).length;

  // Overlap and distance to nearest PR changed line
  const { finding_overlaps_change, finding_change_distance } = computeOverlapAndDistance(
    startLine,
    endLine,
    changedLines,
  );

  const features: OriginModelFeatures = {
    rule_id: finding.rule_id,
    rule_family: getRuleFamily(finding.rule_id),
    severity: finding.severity,
    is_error: finding.severity === 2 ? 1 : 0,
    message_length: finding.message.length,
    has_fix: finding.has_fix ? 1 : 0,
    fix_text_length: (finding.fix_text ?? '').length,
    fix_range_length: fixRangeLength,
    has_suggestions: finding.has_suggestions ? 1 : 0,
    suggestion_count: finding.suggestion_count,
    changed_line_count: changedLines.length,
    file_size_lines: fileSizeLines,
    start_line: startLine,
    finding_start_line_ratio: findingStartLineRatio,
    finding_span_lines: findingSpanLines,
    finding_span_columns: findingSpanColumns,
    pr_change_code_lines: computedPrChangeCodeLines,
    pr_total_findings_in_file: prTotalFindingsInFile,
    same_rule_findings_in_file: sameRuleFindingsInFile,
    same_rule_findings_in_repo: sameRuleFindingsInRepo,
    finding_overlaps_change,
    finding_change_distance,
  };

  // Validate via Zod before returning — catch any logic errors immediately
  const parsed = originModelFeaturesSchema.safeParse(features);
  if (!parsed.success) {
    throw new Error(
      `[featureBuilder] Feature validation failed: ${JSON.stringify(parsed.error.format())}`,
    );
  }

  return parsed.data;
}
