import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunOptions as AxeRunOptions } from 'axe-core';
import type { Page } from 'playwright';
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

/**
 * Drive a real headless browser over a running Angular **dev** build and return
 * component-attributed findings per route. The scan runs *in the page* (via the
 * injected in-page bundle), so `window.ng` is live and each violation is mapped
 * to the component that rendered it — with no change to the target app.
 */
export async function scanPages(options: ScanPagesOptions): Promise<ScanReport> {
  const { baseUrl, routes, tags, waitMs = 1500, labels = {}, setup, headed = false } = options;
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
      // networkidle is the right settle signal for an SPA, but some apps keep a
      // socket open and never reach it — fall back to a plain load.
      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => page.goto(url));
      await page.waitForTimeout(waitMs);
      await page.addScriptTag({ content: inPageScript });
      const findings = (await page.evaluate((opts) => {
        const w = window as unknown as { __ngbA11yScan: (o?: unknown) => Promise<unknown> };
        return w.__ngbA11yScan(opts);
      }, axeOptions)) as A11yFinding[];
      pages.push({ label: labels[route] ?? route, url: page.url(), findings });
    }
  } finally {
    await browser.close();
  }

  return { generatedAt: new Date().toISOString(), pages };
}
