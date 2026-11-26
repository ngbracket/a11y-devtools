import { RULE_DOCS } from '../keyboard/keyboard-scan.js';
import type { A11yFinding } from '../scan.js';
import { ngbrRuleCriteria } from './wcag.js';
import type { PageReport } from './format.js';

export const DUPLICATE_TITLE_RULE = 'ngbr/duplicate-page-title';

/** A page as the title check keys it: path and query, plus a `#/` hash, so one route scanned twice counts once. */
function pageKey(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search + (u.hash.startsWith('#/') ? u.hash : '');
  } catch {
    return url;
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pages to check: scanned, with a title, and not the dark pass of a route
 * (that would only repeat the light pass). An empty title is axe's
 * `document-title` rule, so it's left to that.
 */
function checkedPages(pages: readonly PageReport[]): PageReport[] {
  return pages.filter((p) => !p.error && !p.darkOnly && p.title !== undefined && normalizeTitle(p.title) !== '');
}

/** True when the run scanned 2 or more different pages, so titles could be compared. */
export function titlesCompared(pages: readonly PageReport[]): boolean {
  return new Set(checkedPages(pages).map((p) => pageKey(p.url))).size >= 2;
}

/**
 * One `ngbr/duplicate-page-title` finding per page whose title is the same as
 * another scanned page's (WCAG 2.4.2 Page Titled). A heuristic: two routes that
 * show the same content can share a title, so each finding says to verify it.
 * Keyed by the page's label, for {@link addDuplicateTitleFindings}.
 */
export function duplicateTitleFindings(pages: readonly PageReport[]): Map<string, A11yFinding> {
  const byTitle = new Map<string, PageReport[]>();
  for (const page of checkedPages(pages)) {
    const title = normalizeTitle(page.title!);
    byTitle.set(title, [...(byTitle.get(title) ?? []), page]);
  }
  const findings = new Map<string, A11yFinding>();
  for (const [title, group] of byTitle) {
    const keys = [...new Set(group.map((p) => pageKey(p.url)))];
    if (keys.length < 2) continue;
    for (const page of group) {
      const own = pageKey(page.url);
      const others = keys.filter((k) => k !== own);
      findings.set(page.label, {
        id: DUPLICATE_TITLE_RULE,
        impact: 'moderate',
        help:
          `The page title "${title}" is the same on ${others.length === 1 ? 'another scanned page' : `${others.length} other scanned pages`} ` +
          `(${others.join(', ')}). A title should say what each page is for, so people can tell ` +
          `pages apart in tabs, history and when a screen reader reads the title after a route change. ` +
          `Pages that show the same content can share a title. Heuristic — verify manually.`,
        helpUrl: `${RULE_DOCS}/duplicate-page-title`,
        wcag: ngbrRuleCriteria(DUPLICATE_TITLE_RULE),
        component: null,
        componentPath: [],
        directives: [],
        target: 'title',
        html: `<title>${escapeHtml(title)}</title>`,
      });
    }
  }
  return findings;
}

/** `pages` with each duplicate-title finding added to its page. */
export function addDuplicateTitleFindings(pages: PageReport[]): PageReport[] {
  const findings = duplicateTitleFindings(pages);
  if (!findings.size) return pages;
  return pages.map((page) => {
    const finding = findings.get(page.label);
    return finding ? { ...page, findings: [...page.findings, finding] } : page;
  });
}
