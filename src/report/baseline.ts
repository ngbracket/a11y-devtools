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
  pages: { label: string; findings: A11yFinding[]; error?: string }[];
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
 * Positional parts of a selector: `:nth-child(3)`, `:nth-of-type(2)`,
 * `:first-child`, `:last-of-type` and the like. They change when markup is
 * reordered even though the element is the same.
 */
const POSITIONAL = /:(?:nth-(?:last-)?(?:child|of-type)\([^)]*\)|(?:first|last|only)-(?:child|of-type))/g;

/** Selector functions whose argument is itself a selector. */
const SELECTOR_FUNCTION = /:(?:not|is|where|has)\(/g;

/**
 * Remove {@link POSITIONAL} parts, except inside `:not()`, `:is()`, `:where()`
 * and `:has()`: there a positional part is what tells `li:not(.x:first-child)`
 * from `li:not(.x:last-child)`, so it stays.
 */
function stripPositional(selector: string): string {
  let out = '';
  let from = 0;
  for (const match of selector.matchAll(SELECTOR_FUNCTION)) {
    const open = match.index + match[0].length;
    if (match.index < from) continue; // nested inside a function already kept
    let depth = 1;
    let end = open;
    while (end < selector.length && depth > 0) {
      if (selector[end] === '(') depth++;
      else if (selector[end] === ')') depth--;
      end++;
    }
    out += selector.slice(from, match.index).replace(POSITIONAL, '') + selector.slice(match.index, end);
    from = end;
  }
  return out + selector.slice(from).replace(POSITIONAL, '');
}

/**
 * The counter at the end of a generated id: `#mat-input-3`, `#cdk-overlay-12`,
 * `#pn_id_3`. Only ids with at least two words before the number count, so
 * `#h2`, `#col-12` and `#item-2024`, where the number is part of the name,
 * stay distinct.
 */
const ID_COUNTER = /(#[A-Za-z][A-Za-z0-9]*[-_][\w-]*?[-_])\d+(?=[\s>+~.:#[]|$)/g;

/**
 * A looser identity for the second matching pass: {@link findingKey} with the
 * positional parts and id counters taken out of the selector. A markup
 * reorder changes those, so without this pass a known finding came back as
 * "new" and failed the CI gate.
 */
function looseKey(page: string, finding: A11yFinding): string {
  const target = stripPositional(normalizeTarget(finding.target)).replace(ID_COUNTER, '$1#');
  return [page, finding.id, finding.component ?? '', target].join('\u0000');
}

/**
 * The findings in `findings` that aren't also in `reference`, matched by
 * {@link findingKey} with counts. Used for a dark-mode pass, so it reports only
 * what dark mode adds rather than repeating every light-mode finding.
 */
export function findingsNotIn(findings: A11yFinding[], reference: A11yFinding[]): A11yFinding[] {
  const counts = new Map<string, number>();
  for (const finding of reference) {
    const key = findingKey('', finding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return findings.filter((finding) => {
    const key = findingKey('', finding);
    const left = counts.get(key) ?? 0;
    if (left === 0) return true;
    counts.set(key, left - 1);
    return false;
  });
}

/**
 * Compare `current` with `baseline`. Matching is by {@link findingKey} with
 * counts, then by a looser key that ignores positional selector parts and id
 * counters for whatever is still unpaired. Two identical keys in the current
 * run against one in the baseline leaves one new. Pages are matched by label;
 * a route the baseline never scanned counts entirely as new (add it to the
 * baseline when you add it to CI).
 * Pages that failed to scan in the current run are skipped, so an outage
 * doesn't report everything on that page as fixed. Pages that failed in the
 * *baseline* are skipped too — there's nothing to compare against, so their
 * current findings aren't counted as new (re-record the baseline to cover them).
 */
export function diffAgainstBaseline(current: ScanReport, baseline: BaselineReport): BaselineDiff {
  const failed = new Set(current.pages.filter((p) => p.error).map((p) => p.label));
  const baselineFailed = new Set(baseline.pages.filter((p) => p.error).map((p) => p.label));

  let before: NewFinding[] = baseline.pages
    .filter((page) => !failed.has(page.label))
    .flatMap((page) => page.findings.map((finding) => ({ page: page.label, finding })));
  let after: NewFinding[] = current.pages
    .filter((page) => !baselineFailed.has(page.label))
    .flatMap((page) => page.findings.map((finding) => ({ page: page.label, finding })));

  // Exact keys first, then the loose key for what's left, so a finding whose
  // selector only moved (a reordered list, a shifted id counter) still pairs
  // with its baseline entry. Both passes match with counts: a component that
  // gains a real extra instance of a rule still reports it as added.
  let unchanged = 0;
  for (const key of [findingKey, looseKey]) {
    const result = pair(after, before, key);
    unchanged += result.matched;
    after = result.unmatched;
    before = result.leftover;
  }
  return { added: after, fixed: before, unchanged };
}

/**
 * Pair each item of `current` with one of `baseline` that has the same key.
 * Returns how many paired, the current items with no partner, and the baseline
 * items nobody claimed.
 */
function pair(
  current: NewFinding[],
  baseline: NewFinding[],
  key: (page: string, finding: A11yFinding) => string,
): { matched: number; unmatched: NewFinding[]; leftover: NewFinding[] } {
  const remaining = new Map<string, NewFinding[]>();
  for (const item of baseline) {
    const k = key(item.page, item.finding);
    const bucket = remaining.get(k);
    if (bucket) bucket.push(item);
    else remaining.set(k, [item]);
  }
  let matched = 0;
  const unmatched: NewFinding[] = [];
  for (const item of current) {
    const bucket = remaining.get(key(item.page, item.finding));
    if (bucket && bucket.length > 0) {
      bucket.pop();
      matched++;
    } else {
      unmatched.push(item);
    }
  }
  return { matched, unmatched, leftover: [...remaining.values()].flat() };
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
