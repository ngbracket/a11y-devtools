import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunOptions as AxeRunOptions } from 'axe-core';
import type { Page } from 'playwright';
import { detectTabTrap, type FocusObservation } from '../keyboard/focus-walk.js';
import type { A11yFinding } from '../scan.js';
import type { PageReport, ScanReport } from './format.js';

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
   * Run once against `baseUrl` before scanning — e.g. dismiss a splash or pick a
   * theme (ngx-admin gates its dashboard behind a theme picker). State that
   * persists (localStorage/cookies) carries into the scanned routes.
   */
  setup?: (page: Page) => Promise<void>;
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
    headed = false,
    frameworkPrefixes,
    keyboard,
    focusTraps,
  } = options;
  const axeOptions: AxeRunOptions | undefined = tags
    ? { runOnly: { type: 'tag', values: tags } }
    : undefined;
  const inPageScript = readFileSync(inPageScriptPath(), 'utf8');

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: !headed });
  const pages: PageReport[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    if (setup) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await setup(page);
    }

    for (const route of routes) {
      const url = new URL(route, baseUrl).toString();
      const label = labels[route] ?? route;
      try {
        // networkidle is the right settle signal for an SPA, but some apps keep a
        // socket open and never reach it — fall back to a plain load.
        await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
        await page.waitForTimeout(waitMs);
        await page.addScriptTag({ content: inPageScript });
        const findings = (await page.evaluate((args) => {
          const w = window as unknown as {
            __ngbA11yScan: (a?: unknown, s?: unknown) => Promise<unknown>;
          };
          return w.__ngbA11yScan(args.axe, args.scan);
        }, { axe: axeOptions, scan: { frameworkPrefixes, keyboard } })) as A11yFinding[];
        if (focusTraps) {
          // A failed walk shouldn't throw away the scan's findings — warn and move on.
          try {
            const trap = await walkForFocusTrap(page, frameworkPrefixes);
            if (trap) findings.push(trap);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`ngbr-a11y-report: focus-trap walk failed on ${label}: ${message}`);
          }
        }
        pages.push({ label, url: page.url(), findings });
      } catch (err) {
        // One bad route shouldn't sink the whole run — record it and continue.
        const message = err instanceof Error ? err.message : String(err);
        pages.push({ label, url, findings: [], error: message });
      }
    }
  } finally {
    await browser.close();
  }

  return { generatedAt: new Date().toISOString(), pages };
}
