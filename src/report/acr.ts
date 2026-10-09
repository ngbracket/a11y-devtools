import { createRequire } from 'node:module';
import type { A11yFinding, Impact } from '../scan.js';
import { impactRank, type ScanChecks, type ScanReport } from './format.js';
import { escapeHtml, safeHref, STYLES } from './html.js';
import { criterionForTag, understandingUrl, WCAG22_A_AA, type WcagCriterion } from './wcag.js';

/**
 * ACR worksheet: an automated scan organised by WCAG 2.2 A/AA success
 * criterion, as an *input* to a VPAT/ACR. It never decides conformance.
 * Automated checks can show that something fails; they can't show that a
 * criterion is supported, so no row ever says "Supports" and the Conformance
 * Level and Remarks columns are left for a person to fill in.
 */

/** What the scan found for one criterion. */
export type AcrResult = 'failures' | 'possible-failures' | 'no-failures-detected' | 'not-checked';

export const ACR_RESULT_LABELS: Record<AcrResult, string> = {
  failures: 'Automated failures found',
  'possible-failures': 'Possible failures found — verify manually',
  'no-failures-detected': 'No automated failures detected — manual review required',
  'not-checked': 'No automated checks — manual review required',
};

export const ACR_TITLE = 'Evaluation worksheet — not a conformance report';

/** One rule's findings, summed across pages. */
export interface AcrRuleEvidence {
  rule: string;
  /** From a heuristic `ngbr/*` rule: a candidate to verify, not a confirmed failure. */
  heuristic: boolean;
  /** The worst impact among its findings. */
  impact: Impact;
  instances: number;
  components: string[];
  /** Page labels, e.g. `/settings` or `/settings (dark)`. */
  pages: string[];
  helpUrl: string;
}

export interface AcrRow {
  criterion: WcagCriterion;
  result: AcrResult;
  /** Rules that checked this criterion in this run. */
  checkedBy: string[];
  evidence: AcrRuleEvidence[];
}

export interface AcrWorksheet {
  generatedAt: string;
  checks?: ScanChecks;
  /** Labels of pages that scanned. */
  pagesScanned: string[];
  pagesFailed: { label: string; error: string }[];
  rows: AcrRow[];
  /** Findings from rules not mapped to any WCAG 2.2 A/AA criterion (best practice, AAA, 4.1.1). */
  other: AcrRuleEvidence[];
}

/** The part of axe's rule metadata the worksheet needs (`axe.getRules()`). */
export interface AxeRuleMeta {
  ruleId: string;
  tags: string[];
  enabled?: boolean;
}

/**
 * Our keyboard rules and the criteria their docs cite. All are heuristic:
 * their findings are candidates to verify (a trap can be intended, with a
 * documented way out; an order mismatch can be deliberate).
 */
const NGBR_RULES: Record<string, { criteria: string[]; ranWhen: keyof Pick<ScanChecks, 'keyboard' | 'focusTraps'> }> = {
  'ngbr/unreachable-control': { criteria: ['2.1.1'], ranWhen: 'keyboard' },
  'ngbr/click-without-key': { criteria: ['2.1.1'], ranWhen: 'keyboard' },
  'ngbr/hover-only-content': { criteria: ['2.1.1'], ranWhen: 'keyboard' },
  'ngbr/drag-without-keyboard': { criteria: ['2.1.1', '2.5.7'], ranWhen: 'keyboard' },
  'ngbr/tab-order-mismatch': { criteria: ['2.4.3'], ranWhen: 'keyboard' },
  'ngbr/modal-focus-not-contained': { criteria: ['2.4.3'], ranWhen: 'keyboard' },
  'ngbr/focus-trap': { criteria: ['2.1.2'], ranWhen: 'focusTraps' },
};

export function loadAxeRules(): AxeRuleMeta[] {
  const axe = createRequire(import.meta.url)('axe-core') as { getRules(): AxeRuleMeta[] };
  return axe.getRules();
}

/**
 * The axe rules a run used. Without tags: axe's default ruleset (enabled rules).
 * With tags, axe runs every rule carrying one of them, even rules that are off
 * by default (e.g. `target-size` under `wcag22aa`), but still skips
 * experimental and deprecated rules unless those tags are asked for.
 */
export function axeRulesRun(rules: AxeRuleMeta[], checks?: ScanChecks): AxeRuleMeta[] {
  const tags = checks?.tags;
  const skipped = (r: AxeRuleMeta, tag: string) => r.tags.includes(tag) && !tags?.includes(tag);
  return rules.filter(
    (r) =>
      (tags ? r.tags.some((t) => tags.includes(t)) : r.enabled !== false) &&
      !skipped(r, 'experimental') &&
      !skipped(r, 'deprecated'),
  );
}

/**
 * Organise a report by WCAG 2.2 A/AA criterion. `axeRules` defaults to the
 * installed axe-core's metadata; pass your own to pin it (e.g. in tests).
 */
export function buildAcrWorksheet(report: ScanReport, axeRules: AxeRuleMeta[] = loadAxeRules()): AcrWorksheet {
  const scanned = report.pages.filter((p) => !p.error);
  const allFindings = scanned.flatMap((p) => p.findings);

  // Criterion id → rules that checked it this run. Nothing counts as checked if no page scanned.
  const checkedBy = new Map<string, Set<string>>();
  const check = (criterionId: string, rule: string) => {
    const set = checkedBy.get(criterionId) ?? new Set<string>();
    set.add(rule);
    checkedBy.set(criterionId, set);
  };
  const tagsById = new Map(axeRules.map((r) => [r.ruleId, r.tags]));
  if (scanned.length) {
    for (const rule of axeRulesRun(axeRules, report.checks)) {
      for (const tag of rule.tags) {
        const criterion = criterionForTag(tag);
        if (criterion) check(criterion.id, rule.ruleId);
      }
    }
    for (const [rule, { criteria, ranWhen }] of Object.entries(NGBR_RULES)) {
      // A hand-built report has no `checks`: count a rule as run if it produced findings.
      const ran = report.checks ? report.checks[ranWhen] : allFindings.some((f) => f.id === rule);
      if (ran) criteria.forEach((id) => check(id, rule));
    }
  }

  // Criterion id (or '' for unmapped) → rule → evidence.
  const evidence = new Map<string, Map<string, AcrRuleEvidence>>();
  const add = (key: string, finding: A11yFinding, page: string) => {
    const byRule = evidence.get(key) ?? new Map<string, AcrRuleEvidence>();
    evidence.set(key, byRule);
    let item = byRule.get(finding.id);
    if (!item) {
      item = {
        rule: finding.id,
        heuristic: finding.id in NGBR_RULES,
        impact: finding.impact,
        instances: 0,
        components: [],
        pages: [],
        helpUrl: finding.helpUrl,
      };
      byRule.set(finding.id, item);
    }
    item.instances++;
    if (impactRank(finding.impact) < impactRank(item.impact)) item.impact = finding.impact;
    const component = finding.component ?? '(unknown component)';
    if (!item.components.includes(component)) item.components.push(component);
    if (!item.pages.includes(page)) item.pages.push(page);
  };
  for (const page of scanned) {
    for (const finding of page.findings) {
      const criteria = criteriaFor(finding.id, tagsById);
      if (criteria.length === 0) add('', finding, page.label);
      criteria.forEach((id) => add(id, finding, page.label));
    }
  }

  const sorted = (key: string) =>
    [...(evidence.get(key)?.values() ?? [])].sort(
      (a, b) => impactRank(a.impact) - impactRank(b.impact) || b.instances - a.instances,
    );

  const rows = WCAG22_A_AA.map((criterion): AcrRow => {
    const items = sorted(criterion.id);
    const rules = [...(checkedBy.get(criterion.id) ?? [])];
    let result: AcrResult;
    if (items.some((e) => !e.heuristic)) result = 'failures';
    else if (items.length) result = 'possible-failures';
    else if (rules.length) result = 'no-failures-detected';
    else result = 'not-checked';
    return { criterion, result, checkedBy: rules, evidence: items };
  });

  return {
    generatedAt: report.generatedAt,
    ...(report.checks && { checks: report.checks }),
    pagesScanned: scanned.map((p) => p.label),
    pagesFailed: report.pages.filter((p) => p.error).map((p) => ({ label: p.label, error: p.error! })),
    rows,
    other: sorted(''),
  };
}

function criteriaFor(rule: string, tagsById: Map<string, string[]>): string[] {
  if (rule in NGBR_RULES) return NGBR_RULES[rule].criteria;
  const ids = (tagsById.get(rule) ?? []).map((t) => criterionForTag(t)?.id).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

function countByResult(rows: AcrRow[]): Record<AcrResult, number> {
  const counts: Record<AcrResult, number> = {
    failures: 0,
    'possible-failures': 0,
    'no-failures-detected': 0,
    'not-checked': 0,
  };
  rows.forEach((r) => counts[r.result]++);
  return counts;
}

/** "a, b, c +2 more" */
function shortList(items: string[], max = 3): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} +${items.length - max} more`;
}

function colorSchemes(report: ScanReport): string {
  return report.pages.some((p) => p.colorScheme === 'dark') ? 'light and dark' : 'light';
}

const INTRO =
  'This worksheet organises an automated scan by WCAG 2.2 Level A and AA success criterion, as an ' +
  'input to a VPAT or Accessibility Conformance Report (ACR). It does not decide conformance: automated ' +
  'checks can show that something fails, but not that a criterion is supported. A person needs to ' +
  'evaluate every row and fill in Conformance Level and Remarks.';

const HEURISTIC_NOTE =
  '“Possible failures” come from heuristic keyboard rules (ngbr/*): candidates to verify by hand, not confirmed failures.';

const EXCLUDED_NOTE =
  '4.1.1 Parsing is obsolete in WCAG 2.2 and is not listed. Level AAA is not covered.';

function scanDetails(report: ScanReport, sheet: AcrWorksheet): [string, string][] {
  const c = sheet.checks;
  const details: [string, string][] = [
    ['Scan generated', sheet.generatedAt],
    ['Tool', `@ngbracket/a11y-devtools report-mode${c ? `, axe-core ${c.axeVersion}` : ''}`],
    ['Ruleset', c?.tags ? `axe tags: ${c.tags.join(', ')}` : 'axe default ruleset'],
    ['Keyboard checks', c ? (c.keyboard ? 'on' : 'off') : 'unknown'],
    ['Keyboard-trap walk', c ? (c.focusTraps ? 'on' : 'off') : 'unknown'],
    ['Colour schemes', colorSchemes(report)],
    ['Pages scanned', sheet.pagesScanned.length ? sheet.pagesScanned.join(', ') : 'none'],
  ];
  if (sheet.pagesFailed.length) {
    details.push(['Pages that failed to scan', sheet.pagesFailed.map((p) => `${p.label} (${p.error})`).join('; ')]);
  }
  return details;
}

function evidenceText(e: AcrRuleEvidence): string {
  const kind = e.heuristic ? 'possible' : (e.impact ?? 'n/a');
  return (
    `${e.rule} (${kind}): ${e.instances} instance(s) on ${shortList(e.pages)}; ` +
    `components: ${shortList(e.components)}`
  );
}

function checkedByText(rules: string[]): string {
  return rules.length ? `Checked by: ${shortList(rules)}` : '';
}

/** Escape a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Render the worksheet as Markdown. */
export function toAcrMarkdown(report: ScanReport, axeRules?: AxeRuleMeta[]): string {
  const sheet = buildAcrWorksheet(report, axeRules);
  const counts = countByResult(sheet.rows);
  const out: string[] = [];
  out.push(`# ${ACR_TITLE}`, '');
  out.push(`> ${INTRO}`, '');
  out.push('| | |', '|---|---|');
  out.push('| Product and version | |', '| Evaluator | |', '| Evaluation date | |');
  out.push('| Standard | WCAG 2.2 Level A and AA |');
  for (const [k, v] of scanDetails(report, sheet)) out.push(`| ${cell(k)} | ${cell(v)} |`);
  out.push('');
  out.push('## Summary', '');
  for (const result of Object.keys(ACR_RESULT_LABELS) as AcrResult[]) {
    out.push(`- ${ACR_RESULT_LABELS[result]}: ${counts[result]}`);
  }
  out.push('', `${HEURISTIC_NOTE} ${EXCLUDED_NOTE}`, '');
  out.push('## WCAG 2.2 Level A and AA', '');
  out.push('| Criterion | Level | Automated result | Evidence | Conformance Level | Remarks and Explanations |');
  out.push('|---|---|---|---|---|---|');
  for (const row of sheet.rows) {
    const { criterion } = row;
    const evidence = row.evidence.length
      ? row.evidence.map(evidenceText).join('<br>')
      : checkedByText(row.checkedBy);
    out.push(
      `| [${criterion.id} ${cell(criterion.name)}](${understandingUrl(criterion)}) | ${criterion.level} | ${ACR_RESULT_LABELS[row.result]} | ${cell(evidence)} | | |`,
    );
  }
  if (sheet.other.length) {
    out.push('', '## Other findings', '');
    out.push('Rules not mapped to a WCAG 2.2 A/AA criterion: best practices, Level AAA, or 4.1.1. Worth fixing; not rows in the table above.', '');
    for (const e of sheet.other) out.push(`- ${cell(evidenceText(e))}`);
  }
  return out.join('\n') + '\n';
}

const ACR_STYLES = `
table.acr th[scope], table.acr td:not(:first-child) { text-align: left; vertical-align: top; }
table.acr .level { white-space: nowrap; }
table.acr td.blank { min-width: 8rem; }
.result { font-weight: 600; }
.result-failures { color: var(--critical); }
.result-possible-failures { color: var(--serious); }
dl.fields { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 16px; }
dl.fields dt { font-weight: 600; }
dl.fields dd { margin: 0; overflow-wrap: anywhere; }
ul.evidence { margin: 0; padding-left: 1.1em; }
@media print { .table-wrap { overflow: visible; } }
`;

/** Render the worksheet as one self-contained, accessible HTML document (tables paste into Word). */
export function toAcrHtml(report: ScanReport, axeRules?: AxeRuleMeta[]): string {
  const sheet = buildAcrWorksheet(report, axeRules);
  const counts = countByResult(sheet.rows);
  const out: string[] = [];
  const link = (url: string, text: string) => {
    const href = safeHref(url);
    return href ? `<a href="${href}">${escapeHtml(text)}</a>` : escapeHtml(text);
  };

  out.push('<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<title>${escapeHtml(ACR_TITLE)}</title>`);
  out.push(`<style>${STYLES}${ACR_STYLES}</style>`);
  out.push('</head>', '<body>', '<main>');
  out.push(`<h1>${escapeHtml(ACR_TITLE)}</h1>`);
  out.push(`<p class="scope">${escapeHtml(INTRO)}</p>`);
  out.push('<dl class="fields">');
  out.push('<dt>Product and version</dt><dd></dd><dt>Evaluator</dt><dd></dd><dt>Evaluation date</dt><dd></dd>');
  out.push('<dt>Standard</dt><dd>WCAG 2.2 Level A and AA</dd>');
  for (const [k, v] of scanDetails(report, sheet)) out.push(`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`);
  out.push('</dl>');

  out.push('<section aria-labelledby="summary">', '<h2 id="summary">Summary</h2>', '<ul>');
  for (const result of Object.keys(ACR_RESULT_LABELS) as AcrResult[]) {
    out.push(`<li>${escapeHtml(ACR_RESULT_LABELS[result])}: ${counts[result]}</li>`);
  }
  out.push('</ul>', `<p class="meta">${escapeHtml(HEURISTIC_NOTE)} ${escapeHtml(EXCLUDED_NOTE)}</p>`, '</section>');

  out.push('<section aria-labelledby="criteria">', '<h2 id="criteria">WCAG 2.2 Level A and AA</h2>');
  out.push('<div class="table-wrap"><table class="acr">');
  out.push(
    '<thead><tr><th scope="col">Criterion</th><th scope="col">Level</th><th scope="col">Automated result</th><th scope="col">Evidence</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead>',
  );
  out.push('<tbody>');
  for (const row of sheet.rows) {
    const { criterion } = row;
    const evidence = row.evidence.length
      ? `<ul class="evidence">${row.evidence
          .map((e) => `<li>${link(e.helpUrl, e.rule)} ${escapeHtml(evidenceText(e).slice(e.rule.length + 1))}</li>`)
          .join('')}</ul>`
      : escapeHtml(checkedByText(row.checkedBy));
    out.push(
      `<tr><th scope="row">${link(understandingUrl(criterion), `${criterion.id} ${criterion.name}`)}</th>` +
        `<td class="level">${criterion.level}</td>` +
        `<td><span class="result result-${row.result}">${escapeHtml(ACR_RESULT_LABELS[row.result])}</span></td>` +
        `<td>${evidence}</td><td class="blank"></td><td class="blank"></td></tr>`,
    );
  }
  out.push('</tbody>', '</table></div>', '</section>');

  if (sheet.other.length) {
    out.push('<section aria-labelledby="other">', '<h2 id="other">Other findings</h2>');
    out.push(
      '<p>Rules not mapped to a WCAG 2.2 A/AA criterion: best practices, Level AAA, or 4.1.1. Worth fixing; not rows in the table above.</p>',
    );
    out.push('<ul class="evidence">');
    for (const e of sheet.other) {
      out.push(`<li>${link(e.helpUrl, e.rule)} ${escapeHtml(evidenceText(e).slice(e.rule.length + 1))}</li>`);
    }
    out.push('</ul>', '</section>');
  }

  out.push('</main>', '</body>', '</html>');
  return out.join('\n');
}
