import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunOptions as AxeRunOptions } from 'axe-core';
import type { Browser, Page } from 'playwright';
import { detectTabTrap, type FocusObservation } from '../keyboard/focus-walk.js';
import { OVERLAY_EXCLUDE_SELECTOR } from '../overlay.js';
import type { A11yFinding } from '../scan.js';
import type { ListenerSource } from '../attribution.js';
import { findingsNotIn } from './baseline.js';
import { LISTENER_RECORDER_SCRIPT } from './listener-recorder.js';
import type { Walkthrough } from '../keyboard/walkthrough.js';
import type { NavigationRecord } from '../navigation/record.js';
import type { PageReport, ScanChecks, ScanReport } from './format.js';

/** A colour scheme a pass is scanned in. */
export type ColorScheme = 'light' | 'dark';

/** Passed to the `setup` and `beforeScan` hooks, so they can pick the matching theme. */
export interface ThemeContext {
  /** The scheme this pass scans in. The browser already emulates it for `prefers-color-scheme`. */
  colorScheme: ColorScheme;
}

export interface ScanPagesOptions {
  /** Origin of the running dev server, e.g. `http://localhost:4200`. */
  baseUrl: string;
  /** Route paths to scan, resolved against `baseUrl`, e.g. `['/pages/dashboard']`. */
  routes: string[];
  /** Restrict axe to these tags, e.g. `['wcag22aa']`. Omit for the default ruleset. */
  tags?: string[];
  /** Quiet time (ms) after load before scanning, for SPA settle. Default 1500. */
  waitMs?: number;
  /** Optional human labels keyed by route path (falls back to the route). */
  labels?: Record<string, string>;
  /**
   * Run once per pass against `baseUrl` before scanning — e.g. log in, dismiss a
   * splash, or pick a theme (ngx-admin gates its dashboard behind a theme
   * picker). State that persists (localStorage/cookies) carries into the scanned
   * routes. With `colorScheme: 'both'` it runs once for each pass, in a fresh
   * browser context, and `colorScheme` says which theme to select.
   */
  setup?: (page: Page, context: ThemeContext) => Promise<void>;
  /**
   * Run on every route after it loads and before it's scanned — for a theme that
   * doesn't persist between pages. Gets the pass's `colorScheme` and the route.
   */
  beforeScan?: (page: Page, context: ThemeContext & { route: string }) => Promise<void>;
  /**
   * Which colour scheme(s) to scan in. The browser emulates the scheme, so
   * `prefers-color-scheme` styles apply. `'both'` scans every route twice, and
   * the dark pages list only issues that don't also appear in light (see
   * `PageReport.darkOnly`). Default `'light'`, or `'both'` when `darkClass` /
   * `darkAttribute` is set.
   */
  colorScheme?: ColorScheme | 'both';
  /**
   * For a class-toggled dark theme: add this class to `<html>` before each
   * dark-pass scan (e.g. `'dark'` for Tailwind, `'dark-theme'` for many Material
   * apps). Implies `colorScheme: 'both'` unless set.
   */
  darkClass?: string;
  /**
   * For an attribute-toggled dark theme: set this attribute on `<html>` before
   * each dark-pass scan, e.g. `{ name: 'data-bs-theme', value: 'dark' }`
   * (Bootstrap). Implies `colorScheme: 'both'` unless set.
   */
  darkAttribute?: { name: string; value: string };
  /** Launch a headed browser (for debugging). Default false (headless). */
  headed?: boolean;
  /**
   * Component-name prefixes treated as third-party UI primitives to walk past
   * during attribution. Defaults to `Nb`/`Mat`/`Cdk`/`Mdc`; pass `[]` to
   * attribute to the immediate owner — useful when scanning a component
   * library's own code (so it blames the library component, not a demo wrapper).
   */
  frameworkPrefixes?: readonly string[];
  /**
   * Also run the keyboard layer in-page — heuristic `ngbr/*` findings for
   * keyboard-unreachable controls, click-without-keyboard handlers, hover-only
   * content, drag and drop with no keyboard way, and tab-order mismatches (the
   * last needs real layout, which headless has).
   * Default false.
   */
  keyboard?: boolean;
  /**
   * Also walk each route with **real** Tab presses to find keyboard traps —
   * focus that cycles inside part of the page and never moves on (WCAG 2.1.2),
   * reported as `ngbr/focus-trap`. Runs after the scan, since pressing Tab can
   * change page state (focus handlers, menus). Focus cycling inside an open
   * modal is containment, not a trap, and isn't reported. Default false.
   */
  focusTraps?: boolean;
  /**
   * Also list each route's tab order with every stop's computed role, name,
   * states and owning component: a reading list for checking the keyboard and
   * screen-reader path without opening the app. A computed approximation, not
   * what any one screen reader says. With `colorScheme: 'both'` it runs on the
   * light pass only. Default false.
   */
  walkthrough?: boolean;
  /**
   * Also move between the routes inside the app, in the order given, the way a
   * keyboard user would: focus a link to the next route and press Enter, or
   * when the page has no such link, change the URL with `history.pushState`.
   * Each route then records where focus went, whether the title changed and
   * what live regions announced, and focus left on the page body is reported
   * as `ngbr/focus-lost-on-navigation`. Runs in its own browser session after
   * the scan, once (in the light scheme with `colorScheme: 'both'`). Default false.
   */
  navigation?: boolean;
}

type PlaywrightModule = typeof import('playwright');

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'report-mode needs Playwright, which is an optional dependency. Install it with ' +
        '`npm i -D playwright` and download a browser with `npx playwright install chromium`.',
    );
  }
}

/** Path to the built in-page IIFE, resolved relative to this compiled module. */
function inPageScriptPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'inpage.global.js');
}

interface InPageProbe {
  probe(): { id: FocusObservation; iframe: boolean };
  stopCount(): number;
  trapFinding(cycle: readonly number[], shiftTabEscapes: boolean): A11yFinding | null;
}
type ProbeWindow = {
  __ngbA11yCreateFocusProbe: (prefixes?: readonly string[]) => InPageProbe;
  __ngbA11yFocusProbe: InPageProbe;
};

/**
 * Press Tab through the page until focus either laps the page (no trap) or
 * cycles inside part of it (a trap), then check whether Shift+Tab gets out.
 * Needs the in-page bundle already injected. Returns null when there's no trap,
 * or when the press budget runs out before a verdict (inconclusive — e.g. focus
 * stuck inside an iframe the parent can't see into).
 */
async function walkForFocusTrap(
  page: Page,
  frameworkPrefixes: readonly string[] | undefined,
): Promise<A11yFinding | null> {
  const stops = await page.evaluate((prefixes) => {
    const w = window as unknown as ProbeWindow;
    w.__ngbA11yFocusProbe = w.__ngbA11yCreateFocusProbe(prefixes);
    return w.__ngbA11yFocusProbe.stopCount();
  }, frameworkPrefixes);
  const probe = () =>
    page.evaluate(() => (window as unknown as ProbeWindow).__ngbA11yFocusProbe.probe());

  // Enough for two laps of the page, capped so a huge page can't run forever.
  const budget = Math.min(stops * 2 + 10, 400);
  const observations: FocusObservation[] = [];
  const frames = new Set<number>();
  for (let i = 0; i < budget; i++) {
    await page.keyboard.press('Tab');
    const { id, iframe } = await probe();
    if (iframe && id !== null) frames.add(id);
    observations.push(id);

    const verdict = detectTabTrap(observations, frames);
    if (verdict.kind === 'complete') return null;
    if (verdict.kind === 'trap') {
      const inCycle = new Set(verdict.cycle);
      let shiftTabEscapes = false;
      for (let j = 0; j < verdict.cycle.length + 2 && !shiftTabEscapes; j++) {
        await page.keyboard.press('Shift+Tab');
        const { id: back } = await probe();
        shiftTabEscapes = back === null || !inCycle.has(back);
      }
      return page.evaluate(
        ([cycle, escapes]) =>
          (window as unknown as ProbeWindow).__ngbA11yFocusProbe.trapFinding(cycle, escapes),
        [verdict.cycle, shiftTabEscapes] as const,
      );
    }
  }
  return null;
}

/** What the navigation pass found on arriving at one route. */
interface NavigationResult {
  record: NavigationRecord;
  findings: A11yFinding[];
}

interface InPageFocusLossProbe {
  notifyStable(): void;
  settled(): Promise<void>;
  records(): NavigationRecord[];
  findings(): A11yFinding[];
}
type FocusLossWindow = {
  __ngbA11yCreateFocusLossProbe?: (prefixes?: readonly string[]) => InPageFocusLossProbe;
  __ngbA11yFocusLossProbe?: InPageFocusLossProbe;
};

/** A route as the focus-loss probe keys it: path and query, plus a `#/` hash. */
function routeKey(url: URL): string {
  return url.pathname + url.search + (url.hash.startsWith('#/') ? url.hash : '');
}

/**
 * Load the first route, then move to each next route inside the app and ask the
 * in-page probe what happened to focus. Results are keyed by the route's index
 * in `routes`. A full page load (a link outside the app's router) is not a
 * route change inside the app, so it's skipped with a warning.
 */
async function navigationPass(
  browser: Browser,
  colorScheme: ColorScheme,
  config: PassConfig,
): Promise<Map<number, NavigationResult>> {
  const { baseUrl, routes, waitMs, inPageScript, frameworkPrefixes } = config;
  const results = new Map<number, NavigationResult>();
  if (routes.length < 2) return results;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme,
    bypassCSP: true,
  });
  try {
    const page = await context.newPage();
    if (config.setup) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await config.setup(page, { colorScheme });
    }
    const settle = async () => {
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(waitMs);
    };
    // What the probe has reported so far, so each route takes only its own.
    let recordCount = 0;
    let findingCount = 0;
    const startProbe = async () => {
      recordCount = 0;
      findingCount = 0;
      await page.addStyleTag({ content: HIDE_OVERLAY_CSS });
      await page.addScriptTag({ content: inPageScript });
      await page.evaluate((prefixes) => {
        const w = window as unknown as FocusLossWindow;
        w.__ngbA11yFocusLossProbe = w.__ngbA11yCreateFocusLossProbe!(prefixes);
      }, frameworkPrefixes);
    };
    const probeRunning = () =>
      page.evaluate(() => (window as unknown as FocusLossWindow).__ngbA11yFocusLossProbe !== undefined);

    const first = new URL(routes[0], baseUrl).toString();
    await page.goto(first, { waitUntil: 'networkidle' }).catch(() => page.goto(first));
    await page.waitForTimeout(waitMs);
    await startProbe();

    for (let i = 1; i < routes.length; i++) {
      const route = routes[i];
      const target = new URL(route, baseUrl);
      try {
        // Focus a visible link in the page that goes to this route, in the same
        // tab. Without one, change the URL: the Angular Router (like most SPA
        // routers) follows popstate.
        const via = await page.evaluate((href) => {
          const key = (u: URL) => u.pathname + u.search + (u.hash.startsWith('#/') ? u.hash : '');
          const wanted = key(new URL(href));
          for (const link of document.querySelectorAll('a[href]')) {
            if (!(link instanceof HTMLAnchorElement)) continue; // an SVG <a>
            if (link.target && link.target !== '_self') continue;
            if (link.closest('[data-ngb-a11y-overlay], [inert], [aria-hidden="true"]')) continue;
            if (typeof link.checkVisibility === 'function' && !link.checkVisibility()) continue;
            let url: URL;
            try {
              url = new URL(link.href);
            } catch {
              continue;
            }
            if (url.origin !== location.origin || key(url) !== wanted) continue;
            link.focus();
            if (document.activeElement === link) return 'link' as const;
          }
          history.pushState(null, '', href);
          dispatchEvent(new PopStateEvent('popstate', { state: null }));
          return 'history' as const;
        }, target.toString());
        if (via === 'link') await page.keyboard.press('Enter');
        await settle();

        if (!(await probeRunning())) {
          console.warn(
            `ngbr-a11y-report: moving to ${route} loaded a new page, so it wasn't a route change ` +
              `inside the app; skipped the focus check.`,
          );
          await startProbe();
          continue;
        }
        const seen = await page.evaluate(async () => {
          const probe = (window as unknown as FocusLossWindow).__ngbA11yFocusLossProbe!;
          probe.notifyStable();
          await probe.settled();
          return { records: probe.records(), findings: probe.findings() };
        });
        const record = seen.records.length > recordCount ? seen.records.at(-1) : undefined;
        recordCount = seen.records.length;
        const findings = seen.findings.slice(findingCount);
        findingCount = seen.findings.length;
        if (!record) {
          console.warn(`ngbr-a11y-report: moving to ${route} didn't change the route; skipped the focus check.`);
          continue;
        }
        if (record.to !== routeKey(target)) {
          console.warn(`ngbr-a11y-report: moving to ${route} ended on ${record.to} (a redirect?).`);
        }
        results.set(i, { record: { ...record, via }, findings });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`ngbr-a11y-report: route change to ${route} failed: ${message}`);
        // Start again from what's on the page now, so the next route takes only its own results.
        try {
          await settle();
          if (!(await probeRunning())) {
            await startProbe();
          } else {
            const counts = await page.evaluate(() => {
              const probe = (window as unknown as FocusLossWindow).__ngbA11yFocusLossProbe!;
              return { records: probe.records().length, findings: probe.findings().length };
            });
            recordCount = counts.records;
            findingCount = counts.findings;
          }
        } catch {
          // The page is gone; the next route's own error says so.
        }
      }
    }
  } finally {
    await context.close();
  }
  return results;
}

/** Everything a single colour-scheme pass needs, resolved from the options. */
interface PassConfig {
  baseUrl: string;
  routes: string[];
  labels: Record<string, string>;
  waitMs: number;
  axeOptions: AxeRunOptions | undefined;
  inPageScript: string;
  frameworkPrefixes: readonly string[] | undefined;
  keyboard: boolean | undefined;
  focusTraps: boolean;
  walkthrough: boolean;
  navigation: boolean;
  setup: ScanPagesOptions['setup'];
  beforeScan: ScanPagesOptions['beforeScan'];
  darkClass: string | undefined;
  darkAttribute: ScanPagesOptions['darkAttribute'];
  /** Where each scanned page's keyboard checks read listeners from; filled in by the passes. */
  listenerSources: Set<ListenerSource>;
}

/** Settle time after switching a class/attribute theme, so colour transitions finish before axe reads them. */
const THEME_SETTLE_MS = 300;

/**
 * Hides the in-app overlay (if the app runs it) for the headless scan. Up to
 * 0.18.4 its tab-order path was a fixed SVG that overflowed the viewport, and
 * axe's color-contrast counted it as covering text below the fold: that text
 * came back "needs review" instead of pass/fail, so its contrast was never
 * reported. The SVG is clipped to the viewport since 0.18.5, but the app being
 * scanned may run an older overlay than this report, so the hide stays.
 * Excluding the overlay from axe's context isn't enough; the exclude stops axe
 * checking the overlay, not seeing it.
 */
const HIDE_OVERLAY_CSS = `${OVERLAY_EXCLUDE_SELECTOR} { display: none !important; }`;

/** Scan every route in one colour scheme, in its own browser context. */
async function scanPass(
  browser: Browser,
  colorScheme: ColorScheme,
  config: PassConfig,
): Promise<PageReport[]> {
  const { baseUrl, routes, labels, waitMs, axeOptions, inPageScript, frameworkPrefixes } = config;
  // bypassCSP: the scan runs as an injected inline script (plus a style tag that
  // hides the overlay), which a strict Content-Security-Policy or Trusted Types
  // would block. It only lifts the policy in this scanning browser.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme,
    bypassCSP: true,
  });
  // Before the app's own scripts, so a production build's click and key
  // listeners can be seen without Angular's debug API.
  if (config.keyboard) await context.addInitScript({ content: LISTENER_RECORDER_SCRIPT });
  const pages: PageReport[] = [];
  try {
    const page = await context.newPage();

    if (config.setup) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await config.setup(page, { colorScheme });
    }

    for (const route of routes) {
      const url = new URL(route, baseUrl).toString();
      const base = labels[route] ?? route;
      // Dark pages get their own label, so a dark page's baseline identity never
      // collides with the same route's light page.
      const label = colorScheme === 'dark' ? `${base} (dark)` : base;
      try {
        // networkidle is the right settle signal for an SPA, but some apps keep a
        // socket open and never reach it — fall back to a plain load.
        await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
        await page.waitForTimeout(waitMs);
        if (colorScheme === 'dark' && (config.darkClass || config.darkAttribute)) {
          await page.evaluate(
            ({ cls, attr }) => {
              if (cls) document.documentElement.classList.add(cls);
              if (attr) document.documentElement.setAttribute(attr.name, attr.value);
            },
            { cls: config.darkClass, attr: config.darkAttribute },
          );
          await page.waitForTimeout(THEME_SETTLE_MS);
        }
        if (config.beforeScan) await config.beforeScan(page, { colorScheme, route });
        await page.addStyleTag({ content: HIDE_OVERLAY_CSS });
        await page.addScriptTag({ content: inPageScript });
        const findings = (await page.evaluate((args) => {
          const w = window as unknown as {
            __ngbA11yScan: (a?: unknown, s?: unknown) => Promise<unknown>;
          };
          return w.__ngbA11yScan(args.axe, args.scan);
        }, { axe: axeOptions, scan: { frameworkPrefixes, keyboard: config.keyboard } })) as A11yFinding[];
        if (config.keyboard) {
          config.listenerSources.add(
            await page.evaluate(() =>
              (window as unknown as { __ngbA11yListenerSource: () => ListenerSource }).__ngbA11yListenerSource(),
            ),
          );
        }
        // Before the trap walk: pressing Tab can change the page.
        let walkthrough: Walkthrough | undefined;
        if (config.walkthrough) {
          try {
            walkthrough = await page.evaluate(
              (prefixes) =>
                (
                  window as unknown as {
                    __ngbA11yWalkthrough: (p?: readonly string[]) => Promise<Walkthrough>;
                  }
                ).__ngbA11yWalkthrough(prefixes),
              frameworkPrefixes,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`ngbr-a11y-report: walkthrough failed on ${label}: ${message}`);
          }
        }
        if (config.focusTraps) {
          // A failed walk shouldn't throw away the scan's findings — warn and move on.
          try {
            const trap = await walkForFocusTrap(page, frameworkPrefixes);
            if (trap) findings.push(trap);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`ngbr-a11y-report: focus-trap walk failed on ${label}: ${message}`);
          }
        }
        pages.push({ label, url: page.url(), findings, colorScheme, ...(walkthrough && { walkthrough }) });
      } catch (err) {
        // One bad route shouldn't sink the whole run — record it and continue.
        const message = err instanceof Error ? err.message : String(err);
        pages.push({ label, url, findings: [], error: message, colorScheme });
      }
    }
  } finally {
    await context.close();
  }
  return pages;
}

/**
 * Drive a real headless browser over a running Angular **dev** build and return
 * component-attributed findings per route. The scan runs *in the page* (via the
 * injected in-page bundle), so `window.ng` is live and each violation is mapped
 * to the component that rendered it — with no change to the target app.
 */
export async function scanPages(options: ScanPagesOptions): Promise<ScanReport> {
  const {
    baseUrl,
    routes,
    tags,
    waitMs = 1500,
    labels = {},
    setup,
    beforeScan,
    headed = false,
    frameworkPrefixes,
    keyboard,
    focusTraps = false,
    walkthrough = false,
    navigation = false,
    darkClass,
    darkAttribute,
  } = options;
  const colorScheme = options.colorScheme ?? (darkClass || darkAttribute ? 'both' : 'light');
  const config: PassConfig = {
    baseUrl,
    routes,
    labels,
    waitMs,
    axeOptions: tags ? { runOnly: { type: 'tag', values: tags } } : undefined,
    inPageScript: readFileSync(inPageScriptPath(), 'utf8'),
    frameworkPrefixes,
    keyboard,
    focusTraps,
    walkthrough,
    navigation,
    setup,
    beforeScan,
    darkClass,
    darkAttribute,
    listenerSources: new Set(),
  };

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !headed });
  let pages: PageReport[];
  let moves = new Map<number, NavigationResult>();
  try {
    // Route changes don't depend on the theme: check them once.
    if (navigation && routes.length < 2) {
      console.warn('ngbr-a11y-report: --navigation needs 2 or more routes; skipped the route-change check.');
    }
    moves = navigation
      ? await navigationPass(browser, colorScheme === 'both' ? 'light' : colorScheme, config)
      : new Map<number, NavigationResult>();
    // A route that failed to scan keeps only its error.
    const withMoves = (scanned: PageReport[]): PageReport[] =>
      scanned.map((page, i) => {
        const move = moves.get(i);
        return move && !page.error
          ? { ...page, findings: [...page.findings, ...move.findings], navigation: move.record }
          : page;
      });
    if (colorScheme !== 'both') {
      pages = withMoves(await scanPass(browser, colorScheme, config));
    } else {
      const light = withMoves(await scanPass(browser, 'light', config));
      // Keyboard traps and the tab order don't depend on the theme; doing them twice only costs time.
      const dark = await scanPass(browser, 'dark', { ...config, focusTraps: false, walkthrough: false });
      // Interleave per route (light, then its dark) and keep only what dark adds.
      pages = light.flatMap((lightPage, i) => {
        const darkPage = dark[i];
        const findings = lightPage.error
          ? darkPage.findings
          : findingsNotIn(darkPage.findings, lightPage.findings);
        return [lightPage, { ...darkPage, findings, darkOnly: true }];
      });
    }
  } finally {
    await browser.close();
  }

  const checks: ScanChecks = {
    axeVersion: axeVersion(),
    ...(tags && { tags }),
    keyboard: keyboard ?? false,
    focusTraps,
    ...(walkthrough && { walkthrough }),
    // Only when at least one route change was checked, so the ACR doesn't count a check that didn't happen.
    ...(moves.size > 0 && { navigation: true }),
    ...(keyboard && config.listenerSources.size > 0 && { listeners: weakestSource(config.listenerSources) }),
  };
  return { generatedAt: new Date().toISOString(), checks, pages };
}

/**
 * The run's listener source: the weakest any page had, so the report never
 * claims checks ran on a page where they couldn't.
 */
function weakestSource(sources: ReadonlySet<ListenerSource>): ListenerSource {
  return sources.has('none') ? 'none' : sources.has('browser') ? 'browser' : 'angular';
}

/** Version of the installed axe-core — the one a scan run now would use. */
export function axeVersion(): string {
  return (createRequire(import.meta.url)('axe-core/package.json') as { version: string }).version;
}
