import { describe, expect, it } from 'vitest';
import { diffAgainstBaseline, findingKey, findingsNotIn, parseBaseline } from '../report/baseline';
import { toJson, toMarkdown, type ScanReport } from '../report/format';
import type { A11yFinding } from '../scan';

function finding(partial: Partial<A11yFinding> = {}): A11yFinding {
  return {
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://example.test/image-alt',
    component: 'UserCardComponent',
    componentPath: ['UserCardComponent'],
    directives: [],
    target: 'img',
    html: '<img>',
    ...partial,
  };
}

const report = (pages: ScanReport['pages']): ScanReport => ({ generatedAt: '2026-09-24T00:00:00Z', pages });

describe('findingKey', () => {
  it('ignores Angular style-scoping attributes, which change between builds', () => {
    const a = finding({ target: 'button[_ngcontent-ng-c123]' });
    const b = finding({ target: 'button[_ngcontent-ng-c999]' });
    expect(findingKey('/', a)).toBe(findingKey('/', b));
  });

  it('ignores reworded help text and a changed impact', () => {
    const a = finding({ help: 'old wording', impact: 'serious' });
    const b = finding({ help: 'new wording', impact: 'critical' });
    expect(findingKey('/', a)).toBe(findingKey('/', b));
  });

  it('distinguishes page, rule, component and element', () => {
    const base = findingKey('/', finding());
    expect(findingKey('/other', finding())).not.toBe(base);
    expect(findingKey('/', finding({ id: 'label' }))).not.toBe(base);
    expect(findingKey('/', finding({ component: 'NavComponent' }))).not.toBe(base);
    expect(findingKey('/', finding({ target: 'img.logo' }))).not.toBe(base);
  });
});

describe('diffAgainstBaseline', () => {
  it('splits findings into new, fixed and unchanged', () => {
    const kept = finding();
    const gone = finding({ id: 'label', target: 'input' });
    const fresh = finding({ id: 'button-name', target: 'button' });

    const diff = diffAgainstBaseline(
      report([{ label: '/', url: 'u', findings: [kept, fresh] }]),
      { pages: [{ label: '/', findings: [kept, gone] }] },
    );
    expect(diff.added.map((a) => a.finding.id)).toEqual(['button-name']);
    expect(diff.fixed.map((f) => f.finding.id)).toEqual(['label']);
    expect(diff.unchanged).toBe(1);
  });

  it('matches with counts, so a second identical finding is new', () => {
    const diff = diffAgainstBaseline(
      report([{ label: '/', url: 'u', findings: [finding(), finding()] }]),
      { pages: [{ label: '/', findings: [finding()] }] },
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.unchanged).toBe(1);
  });

  it('treats a route the baseline never scanned as entirely new', () => {
    const diff = diffAgainstBaseline(
      report([{ label: '/new-route', url: 'u', findings: [finding()] }]),
      { pages: [{ label: '/', findings: [] }] },
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].page).toBe('/new-route');
  });

  it("doesn't count a failed route's baseline findings as fixed", () => {
    const diff = diffAgainstBaseline(
      report([{ label: '/', url: 'u', findings: [], error: 'timeout' }]),
      { pages: [{ label: '/', findings: [finding()] }] },
    );
    expect(diff.fixed).toHaveLength(0);
  });

  it('round-trips: a JSON report is a valid baseline for the same run', () => {
    const run = report([{ label: '/', url: 'u', findings: [finding(), finding({ id: 'label' })] }]);
    const diff = diffAgainstBaseline(run, parseBaseline(toJson(run)));
    expect(diff).toEqual({ added: [], fixed: [], unchanged: 2 });
  });
});

describe('findingsNotIn', () => {
  it('keeps only findings the reference does not have, counting duplicates', () => {
    const shared = finding();
    const darkOnly = finding({ id: 'color-contrast', target: 'p.note' });
    expect(findingsNotIn([shared, darkOnly], [shared])).toEqual([darkOnly]);
    expect(findingsNotIn([shared, shared], [shared])).toHaveLength(1);
    expect(findingsNotIn([shared], [])).toEqual([shared]);
  });
});

describe('dark-only pages in the reports', () => {
  const run = report([
    { label: '/', url: 'u', findings: [], colorScheme: 'light' },
    { label: '/ (dark)', url: 'u', findings: [finding()], colorScheme: 'dark', darkOnly: true },
  ]);

  it('Markdown explains that dark lists only what light does not have', () => {
    expect(toMarkdown(run)).toContain('only issues that don’t also appear in light mode');
  });
});

describe('parseBaseline', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseBaseline('# Accessibility report')).toThrow(/not valid JSON/);
  });

  it('rejects JSON that is not a report', () => {
    expect(() => parseBaseline('{"foo": 1}')).toThrow(/pages\[\]\.findings/);
  });
});

describe('report output with a baseline', () => {
  const kept = finding();
  const fresh = finding({ id: 'button-name', target: 'button', impact: 'serious' });
  const run = report([{ label: '/', url: 'u', findings: [kept, fresh] }]);
  const diff = diffAgainstBaseline(run, { pages: [{ label: '/', findings: [kept] }] });

  it('Markdown gets a comparison section and marks new findings', () => {
    const md = toMarkdown(run, diff);
    expect(md).toContain('## Compared with baseline');
    expect(md).toContain('**1 new** · 0 fixed · 1 unchanged');
    expect(md).toContain('- 🆕 **serious · button-name**');
  });

  it('JSON gets a baseline block and stays a valid baseline itself', () => {
    const json = toJson(run, diff);
    const data = JSON.parse(json);
    expect(data.baseline).toMatchObject({ new: 1, fixed: 0, unchanged: 1 });
    expect(data.baseline.newFindings[0]).toMatchObject({ page: '/', id: 'button-name' });
    expect(() => parseBaseline(json)).not.toThrow();
  });

  it('output without a baseline is unchanged', () => {
    expect(toMarkdown(run)).not.toContain('Compared with baseline');
    expect(JSON.parse(toJson(run)).baseline).toBeUndefined();
  });
});
