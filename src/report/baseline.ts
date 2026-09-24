import type { A11yFinding } from '../scan.js';
import type { ScanReport } from './format.js';

/**
 * Baseline/diff for report-mode: compare a run against a previous one so CI can
 * fail only on *new* problems. An app with 40 known issues can still adopt a
 * gate today — the known ones are the baseline, and the gate stops the count
 * going up. Pure (no Node imports), so it's unit-testable and shares the
 * browser-safe constraint of `format.ts`.
 *
 * The baseline is simply an earlier run's JSON report (`--out` writes it), so
 * there's no separate file format to learn or migrate.
 */

/** The parts of a report the diff needs — satisfied by a parsed `toJson` report. */
export interface BaselineReport {
  pages: { label: string; findings: A11yFinding[] }[];
}

/** One finding that's in the current run but not the baseline. */
export interface NewFinding {
  /** Label of the page it's on. */
  page: string;
  finding: A11yFinding;
}

/** Result of comparing a run with its baseline. */
export interface BaselineDiff {
  /** In this run, not in the baseline — the ones a CI gate should fail on. */
  added: NewFinding[];
  /** In the baseline, gone from this run. */
  fixed: NewFinding[];
  /** Present in both. */
  unchanged: number;
}

/**
 * Angular stamps component-style scoping attributes (`_ngcontent-ng-c123…`,
 * `_nghost-…`) whose hash changes between builds. They can appear in an axe
 * selector, so strip them to keep a finding's identity stable across builds.
 */
function normalizeTarget(target: string): string {
  return target.replace(/\[_ng(?:content|host)-[^\]]*\]/g, '').trim();
}

/**
 * A finding's identity across runs: the page, the rule, the owning component,
 * and the (normalized) element selector. Impact and help text are left out on
 * purpose — an axe upgrade rewording a message shouldn't make it "new".
 */
export function findingKey(page: string, finding: A11yFinding): string {
  return [page, finding.id, finding.component ?? '', normalizeTarget(finding.target)].join('\u0000');
}

/**
 * Compare `current` with `baseline`. Matching is by {@link findingKey} with
 * counts, so two identical keys in the current run against one in the baseline
 * leaves one new. Pages are matched by label; a route the baseline never
 * scanned counts entirely as new (add it to the baseline when you add it to CI).
 * Pages that failed to scan in the current run are skipped, so an outage
 * doesn't report everything on that page as fixed.
 */
export function diffAgainstBaseline(current: ScanReport, baseline: BaselineReport): BaselineDiff {
  const failed = new Set(current.pages.filter((p) => p.error).map((p) => p.label));

  const remaining = new Map<string, NewFinding[]>();
  for (const page of baseline.pages) {
    if (failed.has(page.label)) continue;
    for (const finding of page.findings) {
      const key = findingKey(page.label, finding);
      const bucket = remaining.get(key);
      if (bucket) bucket.push({ page: page.label, finding });
      else remaining.set(key, [{ page: page.label, finding }]);
    }
  }

  const added: NewFinding[] = [];
  let unchanged = 0;
  for (const page of current.pages) {
    for (const finding of page.findings) {
      const bucket = remaining.get(findingKey(page.label, finding));
      if (bucket && bucket.length > 0) {
        bucket.pop();
        unchanged++;
      } else {
        added.push({ page: page.label, finding });
      }
    }
  }

  const fixed = [...remaining.values()].flat();
  return { added, fixed, unchanged };
}

/**
 * Read a baseline from its JSON text (a previous `toJson` report). Throws a
 * readable error for anything that isn't one, rather than silently diffing
 * against nothing and failing every finding as new.
 */
export function parseBaseline(json: string): BaselineReport {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('baseline is not valid JSON — pass a report written by `--out` (the .json file).');
  }
  const pages = (data as { pages?: unknown }).pages;
  if (
    !Array.isArray(pages) ||
    !pages.every(
      (p) => typeof p?.label === 'string' && Array.isArray((p as { findings?: unknown }).findings),
    )
  ) {
    throw new Error('baseline has no `pages[].findings` — pass a report written by `--out` (the .json file).');
  }
  return { pages: pages as BaselineReport['pages'] };
}
