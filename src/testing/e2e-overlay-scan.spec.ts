// @vitest-environment node
/**
 * Real-browser check that the overlay doesn't get in the way of a scan of the
 * page under it. jsdom has no layout, so axe's color-contrast can't run there;
 * this drives the built `dist/overlay.js` + `dist/toggle.js` in Chromium with
 * the real axe-core.
 *
 * - The tab-order SVG is clipped to the viewport, so its connector can't make
 *   axe return "needs review" (bgOverlap) for text below the fold.
 * - The pill sits in a labelled region, so axe's `region` rule passes.
 *
 * Skipped when `dist/` hasn't been built or no Playwright Chromium is installed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = resolve(root, 'dist');
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const ready = existsSync(join(dist, 'toggle.js')) && (await chromiumInstalled());

// Two links in view and one far below the fold, off to the right, so the
// tab-order path runs diagonally past the bottom of the viewport and crosses the
// paragraph. The diagonal matters: axe samples points inside the text box, and a
// vertical path along its left edge didn't reproduce the "needs review" result. The low-contrast paragraph below the fold must come
// back as a color-contrast violation, not "needs review".
const PAGE = `<!doctype html>
<html lang="en"><head><title>Overlay scan</title></head><body style="margin:0">
  <main>
    <h1>Overlay scan</h1>
    <a id="a" href="#a" style="position:absolute;left:60px;top:200px">First</a>
    <a id="b" href="#b" style="position:absolute;left:60px;top:400px">Second</a>
    <a id="c" href="#c" style="position:absolute;left:310px;top:1700px">Third</a>
    <div style="height:1500px"></div>
    <p id="below" style="color:#b0b0b0;background:#fff">Low contrast, below the fold</p>
  </main>
  <script type="module">
    import { createOverlay } from '/dist/overlay.js';
    import { createTogglePill } from '/dist/toggle.js';
    const overlay = createOverlay();
    const stops = ['a', 'b', 'c'].map((id, i) => ({
      element: document.getElementById(id),
      order: i + 1,
      tabindex: 0,
      positive: false,
      component: null,
      componentPath: [],
    }));
    overlay.renderTabOrder(stops);
    createTogglePill({ enabled: true, onToggle: () => {} });
    window.ready = true;
  </script>
</body></html>`;

describe.skipIf(!ready)('overlay under an axe scan (real Chromium)', () => {
  let server: Server;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/dist/')) {
        const file = join(dist, url.slice('/dist/'.length));
        if (!file.startsWith(dist) || !existsSync(file)) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(file));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const { chromium } = await import('playwright');
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready);
    await page.addScriptTag({ content: axeSource });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => server?.close(done));
  });

  /**
   * Run one axe rule on the page and sort the result. `excludeOverlay` scans the
   * way `scan()` does; without it, axe sees the page as any other scanner would.
   */
  const runRule = (rule: string, excludeOverlay: boolean) =>
    page.evaluate(async ([id, exclude]) => {
      const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<AxeOut> } }).axe;
      type AxeOut = Record<'violations' | 'incomplete' | 'passes', { nodes: { target: string[] }[] }[]>;
      const out = await axe.run(
        exclude ? { include: [document], exclude: ['[data-ngb-a11y-overlay]'] } : document,
        { runOnly: { type: 'rule', values: [id] } },
      );
      const targets = (k: keyof AxeOut) => out[k].flatMap((r) => r.nodes.map((n) => n.target.join(' ')));
      return { violations: targets('violations'), incomplete: targets('incomplete'), passes: targets('passes') };
    }, [rule, excludeOverlay] as const);

  it('the connector path never covers text below the fold', async () => {
    // The path is drawn: three anchors, the last one past the viewport.
    const points = await page.evaluate(() => document.querySelector('polyline')?.getAttribute('points') ?? '');
    expect(points.split(' ')).toHaveLength(3);

    const result = await runRule('color-contrast', true);
    expect(result.incomplete).not.toContain('#below');
    expect(result.violations).toContain('#below');
  });

  it('keeps the pill inside a landmark for scanners that do not exclude it', async () => {
    const result = await runRule('region', false);
    expect(result.violations).toEqual([]);
    const name = await page.evaluate(() => document.querySelector('[role="switch"]')!.closest('[role="region"]')?.getAttribute('aria-label'));
    expect(name).toBe('Accessibility developer tools');
  });
});
