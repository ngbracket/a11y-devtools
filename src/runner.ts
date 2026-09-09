import { scan, type A11yFinding } from './scan';
import { logFindings, type Logger } from './report';

export interface RunOptions {
  /** Log grouped findings to the console. Default true. */
  log?: boolean;
  /** Sink for reporting; defaults to `console`. */
  logger?: Logger;
}

/** Scan `root`, optionally report, and return the findings. */
export async function runA11yScan(
  root?: Element | Document,
  options: RunOptions = {},
): Promise<A11yFinding[]> {
  const findings = await scan(root ?? document);
  if (options.log !== false) {
    logFindings(findings, options.logger);
  }
  return findings;
}
