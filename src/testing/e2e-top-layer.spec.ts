// @vitest-environment node
/**
 * Real-browser check that the overlay and the on/off pill stay usable over
 * modals. Native `<dialog>.showModal()` and popovers (Angular CDK overlays use
 * them by default from v22) render in the top layer above any z-index, and a
 * modal makes the rest of the page inert — jsdom models none of that, so this
 * drives the built `dist/overlay.js` + `dist/toggle.js` in Chromium.
 *
 * Skipped when `dist/` hasn't been built or no Playwright Chromium is installed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = resolve(root, 'dist');

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const ready = existsSync(join(dist, 'toggle.js')) && (await chromiumInstalled());

// The finding target sits inside the dialog; a CDK-style popover can cover the page.
const PAGE = `<!doctype html>
<html lang="en"><head><title>Top layer</title></head><body>
  <button id="page-btn">Page</button>
  <dialog id="dlg" style="position:fixed;inset:40px auto auto 40px;margin:0;width:500px;height:300px;padding:0">
    <img id="target" src="data:," style="display:block;position:absolute;left:100px;top:100px;width:80px;height:40px" />
    <button id="inner">Inside</button>
  </dialog>
  <div id="cdk" popover="manual" style="inset:0;margin:0;width:100%;height:100%;background:#0006"></div>
  <script type="module">
    import { createOverlay } from '/dist/overlay.js';
    import { createTogglePill } from '/dist/toggle.js';
    window.clicks = 0;
    window.overlay = createOverlay();
    window.pill = createTogglePill({ enabled: true, onToggle: () => window.clicks++ });
    window.ready = true;
  </script>
</body></html>`;

describe.skipIf(!ready)('overlay + pill over the top layer (real Chromium)', () => {
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
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((done) => server?.close(done));
  });

  /** Id/attribute of the topmost element at a point, as the user would hit it. */
  const topAt = (x: number, y: number): Promise<string> =>
    page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return 'none';
      if (el.closest('[role="switch"]')) return 'pill';
      if (el.closest('[data-impact]')) return 'highlight';
      return el.id || el.tagName.toLowerCase();
    }, [x, y] as const);

  /** Centre of the pill button. */
  const pillCentre = (): Promise<{ x: number; y: number }> =>
    page.evaluate(() => {
      const r = document.querySelector('[role="switch"]')!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

  const settle = (): Promise<void> => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

  it('draws highlights and the pill above an open modal dialog, and the pill still works', async () => {
    await page.evaluate(() => {
      (document.getElementById('dlg') as HTMLDialogElement).showModal();
      const w = window as unknown as { overlay: { render(f: unknown[]): void } };
      w.overlay.render([
        { id: 'image-alt', impact: 'critical', help: 'x', helpUrl: '', component: null, directives: [], target: '#target', html: '' },
      ]);
    });
    await settle();

    // The target is at dialog (40,40) + (100,100): its highlight must be on top.
    expect(await topAt(180, 160)).toBe('highlight');

    const { x, y } = await pillCentre();
    expect(await topAt(x, y)).toBe('pill');
    await page.mouse.click(x, y); // a real click: fails if the pill is inert
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(1);
  });

  it('goes back to <body> when the dialog closes', async () => {
    await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).close());
    await settle();
    const parents = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ngb-a11y-overlay][popover]')].map((el) => el.parentElement?.tagName),
    );
    expect(parents).toEqual(['BODY', 'BODY']);
    const { x, y } = await pillCentre();
    expect(await topAt(x, y)).toBe('pill');
  });

  it('stays above a popover the app opens later (CDK overlays)', async () => {
    await page.evaluate(() => (document.getElementById('cdk') as HTMLElement).showPopover());
    await settle();
    const { x, y } = await pillCentre();
    expect(await topAt(x, y)).toBe('pill');
    await page.evaluate(() => (document.getElementById('cdk') as HTMLElement).hidePopover());
  });
});
