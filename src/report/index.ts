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
