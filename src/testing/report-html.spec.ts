import { describe, expect, it } from 'vitest';
import { diffAgainstBaseline } from '../report/baseline';
import type { ScanReport } from '../report/format';
import { toHtml } from '../report/html';
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

const run: ScanReport = {
  generatedAt: '2026-09-24T00:00:00Z',
  pages: [
    {
      label: 'Dashboard',
      url: 'http://localhost:4200/',
      findings: [
        finding({ impact: 'minor', id: 'empty-heading', target: 'h2' }),
        finding(),
        finding({
          component: 'HeaderComponent',
          componentPath: ['NbButtonComponent', 'HeaderComponent'],
          id: 'button-name',
          target: 'button',
        }),
      ],
    },
    { label: 'Empty', url: 'http://localhost:4200/empty', findings: [] },
    { label: 'Broken', url: 'http://localhost:4200/broken', findings: [], error: 'timeout' },
  ],
};

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('toHtml', () => {
  it('is a self-contained document: no scripts, no external stylesheets', () => {
    const doc = parse(toHtml(run));
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.title).toBe('Accessibility report');
    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
    expect(doc.querySelector('style')).not.toBeNull();
  });

  it('has a main landmark and a sequential heading outline', () => {
    const doc = parse(toHtml(run));
    expect(doc.querySelectorAll('main')).toHaveLength(1);
    const levels = [...doc.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1); // never skips a level
    }
  });

  it('summary is a real data table with header cells and a total row', () => {
    const doc = parse(toHtml(run));
    const table = doc.querySelector('table')!;
    expect([...table.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    const rows = [...table.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent);
    expect(rows).toEqual(['Dashboard', 'Empty', 'Broken']);
    expect(table.querySelector('tfoot')!.textContent).toContain('Total');
  });

  it('groups findings by component, most severe first, severity as text', () => {
    const doc = parse(toHtml(run));
    const groups = [...doc.querySelectorAll('.component h3')].map((h) => h.textContent);
    expect(groups[0]).toContain('UserCardComponent');
    expect(groups[0]).toContain('2 issue(s)');
    const impacts = [...doc.querySelectorAll('.component')][0].querySelectorAll('.impact');
    expect([...impacts].map((i) => i.textContent)).toEqual(['critical', 'minor']);
    expect(doc.body.textContent).toContain('(via NbButtonComponent)');
  });

  it('shows empty and failed pages', () => {
    const doc = parse(toHtml(run));
    expect(doc.querySelector('.ok')!.textContent).toBe('No violations found.');
    expect(doc.querySelector('.error')!.textContent).toBe('Scan failed: timeout');
  });

  it('escapes page content, so a finding cannot inject markup', () => {
    const hostile: ScanReport = {
      generatedAt: 'x',
      pages: [
        {
          label: '<img src=x onerror=alert(1)>',
          url: 'u',
          findings: [finding({ help: '<script>alert(1)</script>', target: 'a[title="<b>"]' })],
        },
      ],
    };
    const doc = parse(toHtml(hostile));
    expect(doc.querySelectorAll('script, img, b')).toHaveLength(0);
    expect(doc.body.textContent).toContain('<script>alert(1)</script>');
  });

  it('links only http(s) rule references', () => {
    const doc = parse(toHtml({
      generatedAt: 'x',
      pages: [{ label: 'p', url: 'u', findings: [finding({ helpUrl: 'javascript:alert(1)' })] }],
    }));
    expect(doc.querySelectorAll('a')).toHaveLength(0);
    const linked = parse(toHtml(run));
    const link = linked.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.test/image-alt');
    expect(link.textContent).toContain('Rule reference');
  });

  it('with a baseline, adds a comparison section and labels new findings as text', () => {
    const [first, ...rest] = run.pages[0].findings;
    const diff = diffAgainstBaseline(run, { pages: [{ label: 'Dashboard', findings: rest }] });
    const doc = parse(toHtml(run, diff));
    expect(doc.getElementById('baseline')!.textContent).toBe('Compared with baseline');
    expect(doc.querySelector('.diff')!.textContent).toContain('1 new');
    const marked = [...doc.querySelectorAll('.findings .new')];
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toBe('New');
    expect(marked[0].parentElement!.textContent).toContain(first.id);
  });

  it('explains a dark-only page', () => {
    const doc = parse(toHtml({
      generatedAt: 'x',
      pages: [{ label: '/ (dark)', url: 'u', findings: [], colorScheme: 'dark', darkOnly: true }],
    }));
    expect(doc.body.textContent).toContain('only issues that don’t also appear in light mode');
  });
});
