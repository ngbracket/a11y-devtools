// @vitest-environment node
/**
 * Component attribution in a real Angular app, in a real browser. The other
 * specs check attribution against jsdom fixtures (a stubbed `window.ng`) or
 * plain-HTML pages (no `window.ng` at all); this one builds e2e/angular-app
 * with @angular/build — the builder `ng build` uses — and checks that report
 * mode and the in-app overlay name the right components through Angular's own
 * debug API, and that a production build names none.
 *
 * Skipped when `dist/` hasn't been built or no Playwright Chromium is installed.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScanReport } from '../report/format';
import type { A11yFinding } from '../scan';

const root = resolve(import.meta.dirname, '..', '..');
const distReport = resolve(root, 'dist/report/index.js');
const cli = resolve(root, 'bin/ngbr-a11y-report.mjs');

async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

const ready = existsSync(distReport) && (await chromiumInstalled());

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Serve a built app, falling back to index.html for routes (like `ng serve`). */
async function serveApp(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const file = join(dir, path);
    const found = path !== '/' && file.startsWith(dir) && existsSync(file) ? file : join(dir, 'index.html');
    res.setHeader('content-type', TYPES[extname(found)] ?? 'application/octet-stream');
    res.end(readFileSync(found));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (err, stdout, stderr) => {
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/**
 * The one finding for a rule on the element whose HTML contains `marker` (a
 * class name). Matched on HTML, not the selector: axe reports the shortest
 * unique selector, e.g. `button`.
 */
function find(findings: A11yFinding[], id: string, marker: string): A11yFinding {
  const matches = findings.filter((f) => f.id === id && f.html.includes(marker));
  expect(matches, `${id} on ${marker} in ${JSON.stringify(findings.map((f) => [f.id, f.html]))}`).toHaveLength(1);
  return matches[0];
}

describe.skipIf(!ready)('attribution in a real Angular app (E2E)', () => {
  const servers: Server[] = [];
  let dev: string;
  let prod: string;
  let scanPages: typeof import('../report/index').scanPages;

  beforeAll(async () => {
    // Build in a child process: @angular/build doesn't load inside Vitest's transform pipeline.
    const out = await new Promise<string>((done, fail) => {
      execFile(process.execPath, [resolve(root, 'scripts/build-angular-fixture.mjs')], { cwd: root }, (err, stdout, stderr) =>
        err ? fail(new Error(`fixture build failed:\n${stderr}`)) : done(stdout),
      );
    });
    const [devDir, prodDir] = out.trim().split('\n');
    ({ scanPages } = (await import(distReport)) as typeof import('../report/index'));
    for (const [dir, set] of [
      [devDir, (url: string) => (dev = url)],
      [prodDir, (url: string) => (prod = url)],
    ] as const) {
      const { server, url } = await serveApp(dir);
      servers.push(server);
      set(url);
    }
  }, 120_000);

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  });

  describe('report mode, dev build', () => {
    let report: ScanReport;
    const page = (label: string) => report.pages.find((p) => p.label === label)!;

    beforeAll(async () => {
      report = await scanPages({ baseUrl: dev, routes: ['/', '/settings'], waitMs: 300, keyboard: true });
    }, 60_000);

    it('scans both routes without errors', () => {
      expect(report.pages.map((p) => [p.label, p.error])).toEqual([
        ['/', undefined],
        ['/settings', undefined],
      ]);
    });

    it('attributes a finding to the component whose template has the element', () => {
      const logo = find(page('/').findings, 'image-alt', 'logo');
      expect(logo.component).toBe('HeaderComponent');
      expect(logo.componentPath).toEqual(['HeaderComponent', 'AppComponent']);
    });

    it('attributes projected content to the template that declared it, not the host', () => {
      const projected = find(page('/').findings, 'image-alt', 'projected');
      expect(projected.component).toBe('HomePageComponent');
      // The path follows the DOM, so the panel it's projected through appears too — each component once.
      expect(projected.componentPath).toEqual(['HomePageComponent', 'PanelComponent', 'AppComponent']);
    });

    it('walks past a UI-library primitive to the component that used it', () => {
      const button = find(page('/').findings, 'button-name', 'nb-icon-button');
      expect(button.component).toBe('HomePageComponent');
      expect(button.componentPath.slice(0, 2)).toEqual(['NbFakeButtonComponent', 'HomePageComponent']);
    });

    it('lists directives on the flagged element', () => {
      const input = find(page('/').findings, 'label', 'fancy');
      expect(input.component).toBe('HomePageComponent');
      expect(input.directives).toContain('FancyDirective');
    });

    it('finds keyboard problems through Angular event listeners (ng.getListeners)', () => {
      expect(find(page('/').findings, 'ngbr/unreachable-control', 'fake-button').component).toBe('HomePageComponent');
      expect(find(page('/').findings, 'ngbr/click-without-key', 'focusable-no-key').component).toBe(
        'HomePageComponent',
      );
    });

    it('attributes findings on a second route to that route’s page component', () => {
      expect(find(page('/settings').findings, 'color-contrast', 'faint').component).toBe('SettingsPageComponent');
    });
  });

  it('with no primitive prefixes, blames the primitive itself', async () => {
    const report = await scanPages({ baseUrl: dev, routes: ['/'], waitMs: 300, frameworkPrefixes: [] });
    expect(find(report.pages[0].findings, 'button-name', 'nb-icon-button').component).toBe('NbFakeButtonComponent');
  }, 60_000);

  it('the CLI groups the Markdown report by component', async () => {
    const { code, stdout } = await runCli(['--base', dev, '--route', '/', '--wait', '300']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/### ♿ HomePageComponent — \d+ issue/);
    expect(stdout).toMatch(/### ♿ HeaderComponent — 1 issue/);
  }, 60_000);

  it('a production build has no attribution, and the CLI says why', async () => {
    const { code, stdout, stderr } = await runCli(['--base', prod, '--route', '/', '--wait', '300']);
    expect(code).toBe(0);
    expect(stdout).toContain('image-alt'); // it still scans…
    expect(stdout).toContain('(unknown component)'); // …but can't name components
    expect(stdout).not.toContain('HeaderComponent');
    expect(stderr).toContain('no component attribution (window.ng absent)');
  }, 60_000);

  it('the in-app overlay labels findings with their components', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    try {
      const tab = await browser.newPage();
      await tab.goto(`${dev}/?overlay`);
      const labels = tab.locator('[data-ngb-a11y-overlay] [data-impact] > span');
      await expect.poll(() => labels.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      const text = await labels.allTextContents();
      expect(text).toContain('HeaderComponent · image-alt');
      expect(text).toContain('HomePageComponent · button-name');
      expect(text).toContain('HomePageComponent · ngbr/unreachable-control');
    } finally {
      await browser.close();
    }
  }, 60_000);
});
