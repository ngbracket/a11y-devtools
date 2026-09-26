import { describe, expect, it } from 'vitest';
import {
  buildAcrWorksheet,
  toAcrHtml,
  toAcrMarkdown,
  type AcrRow,
  type AxeRuleMeta,
} from '../report/acr';
import type { ScanReport } from '../report/format';
import { criterionForTag, WCAG22_A_AA } from '../report/wcag';
import type { A11yFinding } from '../scan';

function finding(partial: Partial<A11yFinding> = {}): A11yFinding {
  return {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet minimum color contrast ratio thresholds',
    helpUrl: 'https://example.test/color-contrast',
    component: 'LoginComponent',
    componentPath: ['LoginComponent'],
    directives: [],
    target: 'p.note',
    html: '<p class="note">',
    ...partial,
  };
}

// A pinned slice of axe's metadata, so the tests don't move with axe upgrades.
const RULES: AxeRuleMeta[] = [
  { ruleId: 'color-contrast', tags: ['cat.color', 'wcag2aa', 'wcag143'], enabled: true },
  { ruleId: 'image-alt', tags: ['wcag2a', 'wcag111'], enabled: true },
  { ruleId: 'button-name', tags: ['wcag2a', 'wcag412'], enabled: true },
  { ruleId: 'target-size', tags: ['wcag22aa', 'wcag258'], enabled: false },
  { ruleId: 'audio-caption', tags: ['wcag2a', 'wcag121', 'deprecated'], enabled: false },
  { ruleId: 'region', tags: ['best-practice'], enabled: true },
  { ruleId: 'color-contrast-enhanced', tags: ['wcag2aaa', 'wcag146'], enabled: false },
  { ruleId: 'p-as-heading', tags: ['wcag2a', 'wcag131', 'experimental'], enabled: false },
  { ruleId: 'scrollable-region-focusable', tags: ['wcag2a', 'wcag211', 'wcag213'], enabled: true },
];

const checks = { axeVersion: '4.13.0', keyboard: false, focusTraps: false };

function report(pages: ScanReport['pages'], extra: Partial<ScanReport> = {}): ScanReport {
  return { generatedAt: '2026-09-26T00:00:00Z', checks, pages, ...extra };
}

function row(rows: AcrRow[], id: string): AcrRow {
  return rows.find((r) => r.criterion.id === id)!;
}

describe('WCAG 2.2 criteria', () => {
  it('lists the 55 Level A and AA criteria (31 A, 24 AA), without 4.1.1', () => {
    expect(WCAG22_A_AA).toHaveLength(55);
    expect(WCAG22_A_AA.filter((c) => c.level === 'A')).toHaveLength(31);
    expect(WCAG22_A_AA.map((c) => c.id)).not.toContain('4.1.1');
    expect(new Set(WCAG22_A_AA.map((c) => c.id)).size).toBe(55);
  });

  it('maps axe tags to criteria, including two-digit parts', () => {
    expect(criterionForTag('wcag143')?.id).toBe('1.4.3');
    expect(criterionForTag('wcag1410')?.id).toBe('1.4.10');
    expect(criterionForTag('wcag2411')?.id).toBe('2.4.11');
    expect(criterionForTag('wcag2aa')).toBeUndefined();
    expect(criterionForTag('wcag146')).toBeUndefined(); // AAA
    expect(criterionForTag('wcag411')).toBeUndefined(); // obsolete
  });
});

describe('buildAcrWorksheet', () => {
  it('reports automated failures with rule, pages, components and worst impact', () => {
    const sheet = buildAcrWorksheet(
      report([
        { label: '/login', url: 'http://x/login', findings: [finding(), finding({ impact: 'moderate', target: 'a' })] },
        {
          label: '/login (dark)',
          url: 'http://x/login',
          colorScheme: 'dark',
          darkOnly: true,
          findings: [finding({ component: 'HeaderComponent', impact: 'critical' })],
        },
      ]),
      RULES,
    );
    const contrast = row(sheet.rows, '1.4.3');
    expect(contrast.result).toBe('failures');
    expect(contrast.evidence).toEqual([
      expect.objectContaining({
        rule: 'color-contrast',
        heuristic: false,
        impact: 'critical',
        instances: 3,
        pages: ['/login', '/login (dark)'],
        components: ['LoginComponent', 'HeaderComponent'],
      }),
    ]);
  });

  it('says "no automated failures detected" for a checked criterion, with what checked it', () => {
    const sheet = buildAcrWorksheet(report([{ label: '/', url: 'http://x/', findings: [] }]), RULES);
    expect(row(sheet.rows, '1.1.1')).toMatchObject({ result: 'no-failures-detected', checkedBy: ['image-alt'] });
    expect(row(sheet.rows, '2.1.1').checkedBy).toEqual(['scrollable-region-focusable']);
  });

  it('says "no automated checks" where no rule ran — never a pass', () => {
    const sheet = buildAcrWorksheet(report([{ label: '/', url: 'http://x/', findings: [] }]), RULES);
    expect(row(sheet.rows, '2.4.5')).toMatchObject({ result: 'not-checked', checkedBy: [] });
    // Disabled-by-default and experimental rules don't count as checks.
    expect(row(sheet.rows, '1.3.1').result).toBe('not-checked');
  });

  it('honours --tags: rules outside the tags did not run', () => {
    const sheet = buildAcrWorksheet(
      report([{ label: '/', url: 'http://x/', findings: [] }], { checks: { ...checks, tags: ['wcag2a'] } }),
      RULES,
    );
    expect(row(sheet.rows, '1.1.1').result).toBe('no-failures-detected');
    expect(row(sheet.rows, '1.4.3').result).toBe('not-checked'); // wcag2aa only
    expect(row(sheet.rows, '2.5.8').result).toBe('not-checked'); // wcag22aa only
    // Deprecated rules don't run even when their tag is asked for.
    expect(row(sheet.rows, '1.2.1').result).toBe('not-checked');
  });

  it('with tags, counts rules that are off by default (axe runs them), like target-size', () => {
    const page = [{ label: '/', url: 'http://x/', findings: [] }];
    expect(row(buildAcrWorksheet(report(page), RULES).rows, '2.5.8').result).toBe('not-checked');
    const tagged = buildAcrWorksheet(report(page, { checks: { ...checks, tags: ['wcag22aa'] } }), RULES);
    expect(row(tagged.rows, '2.5.8')).toMatchObject({ result: 'no-failures-detected', checkedBy: ['target-size'] });
  });

  it('counts keyboard rules as checks only when that layer ran', () => {
    const page = [{ label: '/', url: 'http://x/', findings: [] }];
    const off = buildAcrWorksheet(report(page), RULES);
    expect(row(off.rows, '2.1.2').result).toBe('not-checked');
    expect(row(off.rows, '2.4.3').result).toBe('not-checked');

    const on = buildAcrWorksheet(report(page, { checks: { ...checks, keyboard: true, focusTraps: true } }), RULES);
    expect(row(on.rows, '2.1.2')).toMatchObject({ result: 'no-failures-detected', checkedBy: ['ngbr/focus-trap'] });
    expect(row(on.rows, '2.4.3').checkedBy).toEqual(['ngbr/tab-order-mismatch', 'ngbr/modal-focus-not-contained']);
  });

  it('marks heuristic-only findings as possible failures, and axe findings win', () => {
    const k = { checks: { ...checks, keyboard: true } };
    const heuristic = finding({ id: 'ngbr/unreachable-control', impact: 'serious' });
    const possible = buildAcrWorksheet(report([{ label: '/', url: 'http://x/', findings: [heuristic] }], k), RULES);
    expect(row(possible.rows, '2.1.1')).toMatchObject({ result: 'possible-failures' });
    expect(row(possible.rows, '2.1.1').evidence[0].heuristic).toBe(true);

    const both = buildAcrWorksheet(
      report([{ label: '/', url: 'http://x/', findings: [heuristic, finding({ id: 'scrollable-region-focusable' })] }], k),
      RULES,
    );
    expect(row(both.rows, '2.1.1').result).toBe('failures');
    // One axe rule can map to several criteria.
    expect(row(both.rows, '2.1.3')).toBeUndefined(); // AAA, not listed
  });

  it('keeps findings from unmapped rules under "other" instead of dropping them', () => {
    const sheet = buildAcrWorksheet(
      report([{ label: '/', url: 'http://x/', findings: [finding({ id: 'region', impact: 'moderate' })] }]),
      RULES,
    );
    expect(sheet.other.map((e) => e.rule)).toEqual(['region']);
    expect(sheet.rows.every((r) => r.result !== 'failures')).toBe(true);
  });

  it('lists failed pages and ignores them; with nothing scanned, nothing counts as checked', () => {
    const sheet = buildAcrWorksheet(
      report([{ label: '/broken', url: 'http://x/broken', findings: [], error: 'net::ERR_CONNECTION_REFUSED' }]),
      RULES,
    );
    expect(sheet.pagesFailed).toEqual([{ label: '/broken', error: 'net::ERR_CONNECTION_REFUSED' }]);
    expect(sheet.pagesScanned).toEqual([]);
    expect(sheet.rows.every((r) => r.result === 'not-checked')).toBe(true);
  });

  it('without `checks`, assumes the default ruleset and infers keyboard rules from findings', () => {
    const sheet = buildAcrWorksheet(
      {
        generatedAt: 'x',
        pages: [{ label: '/', url: 'http://x/', findings: [finding({ id: 'ngbr/focus-trap' })] }],
      },
      RULES,
    );
    expect(row(sheet.rows, '1.4.3').result).toBe('no-failures-detected');
    expect(row(sheet.rows, '2.1.2').result).toBe('possible-failures');
    expect(row(sheet.rows, '2.4.3').result).toBe('not-checked');
  });

  it('works with the installed axe-core metadata', () => {
    const sheet = buildAcrWorksheet(report([{ label: '/', url: 'http://x/', findings: [] }]));
    expect(row(sheet.rows, '1.4.3').checkedBy).toContain('color-contrast');
    expect(row(sheet.rows, '2.4.5').result).toBe('not-checked');
  });
});

describe('toAcrMarkdown / toAcrHtml', () => {
  const run = report([
    { label: '/login', url: 'http://x/login', findings: [finding(), finding({ id: 'region', impact: 'moderate' })] },
  ]);

  it('never claims support, and leaves the human columns and fields blank', () => {
    for (const text of [toAcrMarkdown(run, RULES), toAcrHtml(run, RULES)]) {
      expect(text).toContain('Evaluation worksheet — not a conformance report');
      expect(text).not.toMatch(/\bSupports\b|\bconforms\b|\bcompliant\b/i);
    }
    const md = toAcrMarkdown(run, RULES);
    expect(md).toContain('| Evaluator | |');
    expect(md).toContain('| Evaluation date | |');
    expect(md).toMatch(/\| \[1\.4\.3 Contrast \(Minimum\)\]\(https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/contrast-minimum\.html\) \| AA \| Automated failures found \| color-contrast \(serious\): 1 instance\(s\) on \/login; components: LoginComponent \| \| \|/);
    expect(md).toContain('## Other findings');
    expect(md).toContain('- region (moderate)');
  });

  it('renders an accessible HTML table with one row per criterion', () => {
    const doc = new DOMParser().parseFromString(toAcrHtml(run, RULES), 'text/html');
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    const rows = doc.querySelectorAll('table.acr tbody tr');
    expect(rows).toHaveLength(55);
    expect(rows[0].querySelector('th[scope="row"] a')?.getAttribute('href')).toBe(
      'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    );
    expect([...doc.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Criterion',
      'Level',
      'Automated result',
      'Evidence',
      'Conformance Level',
      'Remarks and Explanations',
    ]);
    for (const tr of rows) {
      const cells = tr.querySelectorAll('td.blank');
      expect(cells).toHaveLength(2);
      cells.forEach((td) => expect(td.textContent).toBe(''));
    }
  });

  it('escapes hostile component names', () => {
    const hostile = report([
      { label: '/', url: 'http://x/', findings: [finding({ component: '<img src=x onerror=alert(1)>' })] },
    ]);
    const doc = new DOMParser().parseFromString(toAcrHtml(hostile, RULES), 'text/html');
    expect(doc.querySelector('img')).toBeNull();
  });
});
