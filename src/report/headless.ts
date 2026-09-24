import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunOptions as AxeRunOptions } from 'axe-core';
import type { Browser, Page } from 'playwright';
import { detectTabTrap, type FocusObservation } from '../keyboard/focus-walk.js';
import type { A11yFinding } from '../scan.js';
import { findingsNotIn } from './baseline.js';
import type { PageReport, ScanReport } from './format.js';

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
   * keyboard-unreachable controls, click-without-keyboard handlers, and
   * tab-order mismatches (the last needs real layout, which headless has).
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
  setup: ScanPagesOptions['setup'];
  beforeScan: ScanPagesOptions['beforeScan'];
  darkClass: string | undefined;
  darkAttribute: ScanPagesOptions['darkAttribute'];
}

/** Settle time after switching a class/attribute theme, so colour transitions finish before axe reads them. */
const THEME_SETTLE_MS = 300;

/** Scan every route in one colour scheme, in its own browser context. */
async function scanPass(
  browser: Browser,
  colorScheme: ColorScheme,
  config: PassConfig,
): Promise<PageReport[]> {
  const { baseUrl, routes, labels, waitMs, axeOptions, inPageScript, frameworkPrefixes } = config;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme });
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
        await page.addScriptTag({ content: inPageScript });
        const findings = (await page.evaluate((args) => {
          const w = window as unknown as {
            __ngbA11yScan: (a?: unknown, s?: unknown) => Promise<unknown>;
          };
          return w.__ngbA11yScan(args.axe, args.scan);
        }, { axe: axeOptions, scan: { frameworkPrefixes, keyboard: config.keyboard } })) as A11yFinding[];
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
        pages.push({ label, url: page.url(), findings, colorScheme });
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
    setup,
    beforeScan,
    darkClass,
    darkAttribute,
  };

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !headed });
  let pages: PageReport[];
  try {
    if (colorScheme !== 'both') {
      pages = await scanPass(browser, colorScheme, config);
    } else {
      const light = await scanPass(browser, 'light', config);
      // A keyboard trap doesn't depend on the theme; walking it twice only costs time.
      const dark = await scanPass(browser, 'dark', { ...config, focusTraps: false });
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

  return { generatedAt: new Date().toISOString(), pages };
}
