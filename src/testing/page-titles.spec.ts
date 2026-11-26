import { describe, expect, it } from 'vitest';
import type { PageReport } from '../report/format';
import { addDuplicateTitleFindings, duplicateTitleFindings, titlesCompared } from '../report/page-titles';

const page = (label: string, path: string, title: string | undefined, extra: Partial<PageReport> = {}): PageReport => ({
  label,
  url: `http://localhost:4200${path}`,
  ...(title !== undefined && { title }),
  findings: [],
  ...extra,
});

describe('duplicateTitleFindings', () => {
  it('flags every page that shares a title with another page', () => {
    const found = duplicateTitleFindings([
      page('Book class', '/book/class', 'Leisure Centres'),
      page('Book activity', '/book/activity', '  Leisure   Centres '),
      page('Home', '/', 'Leisure Centres'),
      page('About', '/about', 'About us | Leisure Centres'),
    ]);
    expect([...found.keys()]).toEqual([0, 1, 2]);
    const finding = found.get(0)!;
    expect(finding).toMatchObject({
      id: 'ngbr/duplicate-page-title',
      impact: 'moderate',
      wcag: ['2.4.2'],
      component: null,
      target: 'title',
      html: '<title>Leisure Centres</title>',
      helpUrl: 'https://ngbracket.com/tools/a11y-devtools/docs/duplicate-page-title',
    });
    expect(finding.help).toContain('the same on 2 other scanned pages (/book/activity, /)');
    expect(finding.help).toContain('Heuristic');
    expect(found.get(2)!.help).toContain('(/book/class, /book/activity)');
  });

  it('says "another scanned page" for a pair', () => {
    const found = duplicateTitleFindings([page('A', '/a', 'Shop'), page('B', '/b', 'Shop')]);
    expect(found.get(0)!.help).toContain('the same on another scanned page (/b)');
  });

  it('treats hash routes as different pages, and an in-page anchor as the same page', () => {
    expect(duplicateTitleFindings([page('A', '/#/a', 'Shop'), page('B', '/#/b', 'Shop')]).size).toBe(2);
    expect(duplicateTitleFindings([page('A', '/a', 'Shop'), page('A again', '/a#main', 'Shop')]).size).toBe(0);
  });

  it('skips failed pages, dark passes and empty or unknown titles', () => {
    expect(
      duplicateTitleFindings([
        page('A', '/a', 'Shop'),
        page('A (dark)', '/a', 'Shop', { colorScheme: 'dark', darkOnly: true }),
        page('B', '/b', 'Shop', { error: 'Timeout' }),
        page('C', '/c', ''),
        page('D', '/d', ''),
        page('E', '/e', undefined),
      ]).size,
    ).toBe(0);
  });

  it('escapes the title in the html snippet', () => {
    const found = duplicateTitleFindings([page('A', '/a', 'Tom & <Jerry>'), page('B', '/b', 'Tom & <Jerry>')]);
    expect(found.get(0)!.html).toBe('<title>Tom &amp; &lt;Jerry&gt;</title>');
  });
});

describe('titlesCompared', () => {
  it('needs 2 or more different pages with titles', () => {
    expect(titlesCompared([page('A', '/a', 'Shop')])).toBe(false);
    expect(titlesCompared([page('A', '/a', 'Shop'), page('A (dark)', '/a', 'Shop', { darkOnly: true })])).toBe(false);
    expect(titlesCompared([page('A', '/a', 'Shop'), page('B', '/b', 'Basket')])).toBe(true);
  });
});

describe('addDuplicateTitleFindings', () => {
  it('gives each page its own finding when two routes share a label', () => {
    const out = addDuplicateTitleFindings([page('Same', '/a', 'Shop'), page('Same', '/b', 'Shop')]);
    expect(out[0].findings[0].help).toContain('(/b)');
    expect(out[1].findings[0].help).toContain('(/a)');
  });

  it('appends the finding to its page and leaves the others as they were', () => {
    const pages = [page('A', '/a', 'Shop'), page('B', '/b', 'Shop'), page('C', '/c', 'Basket')];
    const out = addDuplicateTitleFindings(pages);
    expect(out[0].findings.map((f) => f.id)).toEqual(['ngbr/duplicate-page-title']);
    expect(out[2]).toBe(pages[2]);
    expect(pages[0].findings).toEqual([]);
  });
});
