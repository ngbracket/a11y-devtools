import type { A11yFinding, Impact } from '../scan.js';
import type { BaselineDiff } from './baseline.js';

/**
 * Pure formatting for report-mode: grouping + Markdown/JSON serialization. Kept
 * free of any Node or Playwright imports so the browser side (`report.ts`) can
 * share `groupByComponent` without dragging headless code into the app bundle.
 */

/** One scanned page/route and everything found on it. */
export interface PageReport {
  /** Human label for the page, e.g. `Dashboard`. */
  label: string;
  /** The URL actually scanned. */
  url: string;
  findings: A11yFinding[];
  /** Set when this route failed to scan; findings will be empty. */
  error?: string;
  /** Colour scheme the page was scanned in; absent means the browser default (light). */
  colorScheme?: 'light' | 'dark';
  /**
   * True on the dark pass of a `colorScheme: 'both'` run: findings are only the
   * ones that don't also appear in the light pass of the same route.
   */
  darkOnly?: boolean;
}

/** One-line explanation for a dark-only page, shared by the Markdown and HTML reports. */
export const DARK_ONLY_NOTE =
  'Dark mode: lists only issues that don’t also appear in light mode on this route.';

/** A whole report-mode run across one or more pages. */
export interface ScanReport {
  /** ISO timestamp of the run. */
  generatedAt: string;
  pages: PageReport[];
}

/**
 * Group findings by the component that rendered them — the readable form the
 * attribution makes possible ("♿ HeaderComponent — 2 issues" beats a list of
 * CSS selectors). Insertion order is preserved so callers stay deterministic.
 */
export function groupByComponent(findings: A11yFinding[]): Map<string, A11yFinding[]> {
  const byComponent = new Map<string, A11yFinding[]>();
  for (const finding of findings) {
    const key = finding.component ?? '(unknown component)';
    const bucket = byComponent.get(key);
    if (bucket) bucket.push(finding);
    else byComponent.set(key, [finding]);
  }
  return byComponent;
}

/**
 * Distinct axe rules vs. raw node-instances — the honest pair. A "54" headline
 * is usually one rule firing dozens of times; distinct rules is the number that
 * actually describes an app. Reports surface both so neither can mislead.
 */
export function distinctRuleCount(findings: A11yFinding[]): number {
  return new Set(findings.map((f) => f.id)).size;
}

const IMPACT_RANK: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

function impactRank(impact: Impact): number {
  return impact ? (IMPACT_RANK[impact] ?? 4) : 4;
}

/**
 * Serialize a report to JSON, with per-page and overall summary counts. With a
 * baseline `diff`, adds a `baseline` block (counts + the new findings). The
 * output stays a valid baseline for the next run.
 */
export function toJson(report: ScanReport, diff?: BaselineDiff): string {
  const all = report.pages.flatMap((p) => p.findings);
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      summary: {
        pages: report.pages.length,
        distinctRules: distinctRuleCount(all),
        nodeInstances: all.length,
      },
      ...(diff && {
        baseline: {
          new: diff.added.length,
          fixed: diff.fixed.length,
          unchanged: diff.unchanged,
          newFindings: diff.added.map(({ page, finding }) => ({ page, ...finding })),
        },
      }),
      pages: report.pages.map((p) => ({
        label: p.label,
        url: p.url,
        distinctRules: distinctRuleCount(p.findings),
        nodeInstances: p.findings.length,
        findings: p.findings,
      })),
    },
    null,
    2,
  );
}

/** UI primitives and directives a finding came through, for a "via …" note. */
export function viaNames(finding: A11yFinding): string[] {
  // e.g. an `<button nbButton>` shows as "via NbButtonComponent" under its app owner.
  const ownerIndex = finding.component ? finding.componentPath.indexOf(finding.component) : -1;
  const wrappers = ownerIndex > 0 ? finding.componentPath.slice(0, ownerIndex) : [];
  return [...wrappers, ...finding.directives];
}

/** Findings sorted most severe first (stable within an impact level). */
export function bySeverity(findings: A11yFinding[]): A11yFinding[] {
  return [...findings].sort((a, b) => impactRank(a.impact) - impactRank(b.impact));
}

/** A baseline diff's new findings, most severe first — what to look at first. */
export function addedBySeverity(diff: BaselineDiff): BaselineDiff['added'] {
  return [...diff.added].sort((a, b) => impactRank(a.finding.impact) - impactRank(b.finding.impact));
}

/**
 * Render a human-readable Markdown report grouped by owning component. With a
 * baseline `diff`, adds a comparison section and marks new findings.
 */
export function toMarkdown(report: ScanReport, diff?: BaselineDiff): string {
  const all = report.pages.flatMap((p) => p.findings);
  const lines: string[] = [];

  lines.push('# Accessibility report');
  lines.push('');
  lines.push(`_Generated ${report.generatedAt} · @ngbracket/a11y-devtools report-mode_`);
  lines.push('');

  // Summary table — distinct rules alongside raw node-instances, so the headline
  // count can't be read as "how bad is it" on its own.
  lines.push('## Summary');
  lines.push('');
  lines.push('| Page | Distinct rules | Node-instances | Components |');
  lines.push('|---|---:|---:|---:|');
  for (const page of report.pages) {
    lines.push(
      `| ${page.label} | ${distinctRuleCount(page.findings)} | ${page.findings.length} | ${groupByComponent(page.findings).size} |`,
    );
  }
  lines.push(
    `| **Total** | **${distinctRuleCount(all)}** | **${all.length}** | **${groupByComponent(all).size}** |`,
  );
  lines.push('');

  const added = new Set(diff?.added.map((a) => a.finding));
  if (diff) {
    lines.push('## Compared with baseline');
    lines.push('');
    lines.push(
      `**${diff.added.length} new** · ${diff.fixed.length} fixed · ${diff.unchanged} unchanged`,
    );
    lines.push('');
    for (const { page, finding } of addedBySeverity(diff)) {
      lines.push(
        `- 🆕 **${finding.impact ?? 'n/a'} · ${finding.id}** on ${page}, in ${finding.component ?? '(unknown component)'}: \`${finding.target}\``,
      );
    }
    if (diff.added.length) lines.push('');
  }

  for (const page of report.pages) {
    lines.push(`## ${page.label} — \`${page.url}\``);
    lines.push('');
    if (page.darkOnly) {
      lines.push(`_${DARK_ONLY_NOTE}_`);
      lines.push('');
    }
    if (page.error) {
      lines.push(`⚠️ Scan failed: ${page.error}`);
      lines.push('');
      continue;
    }
    if (page.findings.length === 0) {
      lines.push('No violations found. ✅');
      lines.push('');
      continue;
    }
    lines.push(
      `${page.findings.length} node-instance(s) across ${distinctRuleCount(page.findings)} distinct rule(s).`,
    );
    lines.push('');

    const byComponent = [...groupByComponent(page.findings)].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [component, items] of byComponent) {
      lines.push(`### ♿ ${component} — ${items.length} issue(s)`);
      lines.push('');
      for (const finding of bySeverity(items)) {
        const via = viaNames(finding);
        const suffix = via.length ? ` _(via ${via.join(', ')})_` : '';
        const isNew = added.has(finding) ? '🆕 ' : '';
        lines.push(`- ${isNew}**${finding.impact ?? 'n/a'} · ${finding.id}**: ${finding.help}${suffix}`);
        lines.push(`  - \`${finding.target}\``);
        lines.push(`  - ${finding.helpUrl}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
