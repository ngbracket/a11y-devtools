export { scanPages, type ScanPagesOptions } from './headless.js';
export {
  groupByComponent,
  distinctRuleCount,
  toJson,
  toMarkdown,
  type PageReport,
  type ScanReport,
} from './format.js';
export { toHtml } from './html.js';
export {
  diffAgainstBaseline,
  findingKey,
  parseBaseline,
  type BaselineDiff,
  type BaselineReport,
  type NewFinding,
} from './baseline.js';
