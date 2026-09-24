// @vitest-environment node
/**
 * Real headless E2E: drives the *built* report-mode (`dist/`) through a real
 * Chromium over small static pages served on localhost — the path every other
 * spec only reaches through fixtures. It covers the parts that need a real
 * browser: layout (tab-order mismatch), and real Tab presses (the focus-trap
 * walk, which synthetic events can't exercise).
 *
 * The pages are plain HTML, so there's no `window.ng` and findings are
 * unattributed (component null) — attribution itself is covered by the jsdom
 * specs. Skipped when `dist/` hasn't been built or no Playwright Chromium is
 * installed (`npx playwright install chromium`).
 */
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distReport = resolve(root, 'dist/report/index.js');

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const ready = existsSync(distReport) && (await chromiumInstalled());

const PAGES: Record<string, string> = {
  // Healthy: native controls in order, plus an iframe (Tab inside a frame shows
  // up as repeated focus on the <iframe>, which must not read as a trap).
  '/clean': `
    <main>
      <h1>Clean</h1>
      <button>One</button>
      <a href="#x">Two</a>
      <iframe title="Embedded" srcdoc="<button>In 1</button><button>In 2</button>"></iframe>
      <input aria-label="Three" />
    </main>`,

  // Tab is intercepted on the last field and sent back to the first — a trap.
  // Shift+Tab still escapes, so it's the "moderate" case.
  '/trap': `
    <main>
      <h1>Trap</h1>
      <button>Before</button>
      <div id="widget">
        <input id="first" aria-label="First" />
        <input id="last" aria-label="Last" />
      </div>
      <button>After (never reached)</button>
    </main>
    <script>
      document.getElementById('last').addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          document.getElementById('first').focus();
        }
      });
    </script>`,

  // An editor that swallows every Tab, Shift+Tab included — the "serious" case.
  '/editor': `
    <main>
      <h1>Editor</h1>
      <button>Before</button>
      <textarea id="code" aria-label="Code"></textarea>
      <button>After</button>
    </main>
    <script>
      document.getElementById('code').addEventListener('keydown', (e) => {
        if (e.key === 'Tab') e.preventDefault();
      });
    </script>`,

  // A correct modal: the background is inert and focus cycles inside the dialog.
  // Containment working as intended — no trap, no missing-trap finding.
  '/modal': `
    <main inert>
      <h1>Page behind</h1>
      <button>Behind</button>
    </main>
    <div role="dialog" aria-modal="true" aria-label="Confirm">
      <button id="ok">OK</button>
      <button id="cancel">Cancel</button>
    </div>
    <script>
      const ok = document.getElementById('ok');
      const cancel = document.getElementById('cancel');
      cancel.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ok.focus(); }
      });
      ok.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cancel.focus(); }
      });
    </script>`,

  // Plain axe + layout: a missing alt, and a positive tabindex that jumps up the page.
  '/axe': `
    <main>
      <h1>Axe</h1>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="10" height="10" />
      <button>Top</button>
      <p style="margin-top: 200px"><button tabindex="1">Bottom, but first</button></p>
    </main>`,
};

function html(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title></head><body>${body}</body></html>`;
}

describe.skipIf(!ready)('report-mode in a real browser (E2E)', () => {
  let server: Server;
  let baseUrl: string;
  let report: import('../report/format').ScanReport;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = PAGES[req.url ?? ''];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body ? html(body) : 'not found');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { scanPages } = (await import(distReport)) as typeof import('../report/index');
    report = await scanPages({
      baseUrl,
      routes: Object.keys(PAGES),
      waitMs: 50,
      keyboard: true,
      focusTraps: true,
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise((done) => server?.close(done));
  });

  const page = (label: string) => {
    const found = report.pages.find((p) => p.label === label);
    if (!found) throw new Error(`no page ${label}`);
    expect(found.error).toBeUndefined();
    return found;
  };
  const ids = (label: string) => page(label).findings.map((f) => f.id);

  it('scans every route without errors', () => {
    expect(report.pages.map((p) => p.label)).toEqual(Object.keys(PAGES));
  });

  it('reports axe violations and layout-dependent keyboard findings', () => {
    expect(ids('/axe')).toContain('image-alt');
    expect(ids('/axe')).toContain('ngbr/tab-order-mismatch');
  });

  it('finds no trap on a healthy page, iframe included', () => {
    expect(ids('/clean')).not.toContain('ngbr/focus-trap');
  });

  it('finds a Tab-only trap and records that Shift+Tab escapes', () => {
    const trap = page('/trap').findings.find((f) => f.id === 'ngbr/focus-trap');
    expect(trap).toBeDefined();
    expect(trap!.impact).toBe('moderate');
    expect(trap!.target).toBe('div#widget');
    expect(trap!.help).toContain('Tab cycles through 2 controls');
    expect(trap!.component).toBeNull(); // static page: no window.ng
  });

  it('finds an editor that swallows Tab and Shift+Tab as serious', () => {
    const trap = page('/editor').findings.find((f) => f.id === 'ngbr/focus-trap');
    expect(trap).toBeDefined();
    expect(trap!.impact).toBe('serious');
    expect(trap!.target).toBe('textarea#code');
  });

  it('does not report focus correctly contained in an open modal', () => {
    expect(ids('/modal')).not.toContain('ngbr/focus-trap');
    expect(ids('/modal')).not.toContain('ngbr/modal-focus-not-contained');
  });
});
