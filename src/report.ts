import type { A11yFinding } from './scan.js';
import { groupByComponent } from './report/format.js';

/** Minimal console-shaped sink, so reporting is testable without the real console. */
export interface Logger {
  groupCollapsed(label: string): void;
  groupEnd(): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
}

/**
 * Log findings grouped by the component that owns them — the readable form the
 * attribution makes possible ("♿ UserCardComponent — 2 issues" beats a list of
 * CSS selectors).
 */
export function logFindings(findings: A11yFinding[], logger: Logger = console): void {
  if (findings.length === 0) {
    logger.info('♿ a11y-devtools: no violations found');
    return;
  }

  const byComponent = groupByComponent(findings);

  logger.info(
    `♿ a11y-devtools: ${findings.length} issue(s) across ${byComponent.size} component(s)`,
  );

  for (const [component, items] of byComponent) {
    logger.groupCollapsed(`♿ ${component} — ${items.length} issue(s)`);
    for (const finding of items) {
      const via = finding.directives.length ? ` [via ${finding.directives.join(', ')}]` : '';
      logger.warn(
        `${finding.impact ?? 'n/a'} · ${finding.id}: ${finding.help}${via}`,
        `\n  ${finding.target}\n  ${finding.helpUrl}`,
      );
    }
    logger.groupEnd();
  }
}
