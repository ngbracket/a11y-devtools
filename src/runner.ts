import type { RunOptions as AxeRunOptions } from 'axe-core';
import { scan, type A11yFinding } from './scan.js';
import { logFindings, type Logger } from './report.js';

export interface RunOptions {
  /** Log grouped findings to the console. Default true. */
  log?: boolean;
  /** Sink for reporting; defaults to `console`. */
  logger?: Logger;
  /**
   * axe-core run options — use this to scope the ruleset, e.g.
   * `{ runOnly: { type: 'tag', values: ['wcag22aa'] } }`. Omit to run axe-core's
   * default ruleset: the machine-testable rules across WCAG 2.0/2.1/2.2 (Levels
   * A & AA) plus axe's best-practice rules. (The provider exposes the common case
   * as a friendlier `tags: string[]`.)
   */
  axe?: AxeRunOptions;
}

/** Scan `root`, optionally report, and return the findings. */
export async function runA11yScan(
  root?: Element | Document,
  options: RunOptions = {},
): Promise<A11yFinding[]> {
  const findings = await scan(root ?? document, options.axe);
  if (options.log !== false) {
    logFindings(findings, options.logger);
  }
  return findings;
}
