export {
  scanPages,
  type ColorScheme,
  type ScanPagesOptions,
  type ThemeContext,
} from './headless.js';
export {
  groupByComponent,
  distinctRuleCount,
  toJson,
  toMarkdown,
  DARK_ONLY_NOTE,
  type PageReport,
  type ScanChecks,
  type ScanReport,
} from './format.js';
export { toHtml } from './html.js';
export {
  diffAgainstBaseline,
  findingKey,
  findingsNotIn,
  parseBaseline,
  type BaselineDiff,
  type BaselineReport,
  type NewFinding,
} from './baseline.js';
export { isServing, startDevServer, type DevServer, type DevServerOptions } from './serve.js';
export {
  ACR_RESULT_LABELS,
  ACR_TITLE,
  buildAcrWorksheet,
  toAcrHtml,
  toAcrMarkdown,
  type AcrResult,
  type AcrRow,
  type AcrRuleEvidence,
  type AcrWorksheet,
  type AxeRuleMeta,
} from './acr.js';
export { WCAG22_A_AA, understandingUrl, type WcagCriterion } from './wcag.js';
