// @vitest-environment node
/**
 * `--from`: the CLI re-renders a saved JSON report without scanning. Drives the
 * real bin against the *built* `dist/` (skipped when it hasn't been built), but
 * needs no browser — nothing is scanned. The same round trip over a real scan
 * is in e2e-report.spec.ts.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toAcrMarkdown } from '../report/acr';
import { toHtml } from '../report/html';
import { toJson, toMarkdown, type ScanReport } from '../report/format';
import { axeVersion } from '../report/headless';
import type { A11yFinding } from '../scan';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = resolve(root, 'bin/ngbr-a11y-report.mjs');
const built = existsSync(resolve(root, 'dist/report/index.js'));

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(process.execPath, [cli, ...args], { cwd: root }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      done({ code, stdout, stderr });
    });
  });
}

const finding = (over: Partial<A11yFinding>): A11yFinding => ({
  id: 'image-alt',
  impact: 'critical',
  help: 'Images must have alternate text',
  helpUrl: 'https://example.test/image-alt',
  component: 'UserCardComponent',
  componentPath: ['UserCardComponent', 'AppComponent'],
  directives: [],
  target: 'img',
  html: '<img>',
  ...over,
});

const report: ScanReport = {
  generatedAt: '2026-09-20T09:30:00.000Z',
  checks: { axeVersion: axeVersion(), keyboard: true, focusTraps: false },
  pages: [
    {
      label: '/home',
      url: 'http://localhost:4200/home',
      findings: [finding({}), finding({ id: 'button-name', impact: 'serious', component: 'NavComponent' })],
    },
    { label: '/login', url: 'http://localhost:4200/login', findings: [] },
  ],
};

describe.skipIf(!built)('CLI: --from re-renders a saved report', () => {
  let dir: string;
  let saved: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ngbr-a11y-from-'));
    saved = join(dir, 'saved.json');
    writeFileSync(saved, toJson(report));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes every format exactly as a scan would have', async () => {
    const out = join(dir, 'again');
    const { code, stderr } = await runCli(['--from', saved, '--out', out, '--format', 'all,acr-md']);
    expect(code).toBe(0);
    expect(stderr).toContain('Read 2 route(s) · 2 node-instance(s)');
    expect(stderr).toContain('scanned 2026-09-20T09:30:00.000Z');
    expect(readFileSync(`${out}.md`, 'utf8')).toBe(toMarkdown(report));
    expect(readFileSync(`${out}.json`, 'utf8')).toBe(toJson(report));
    expect(readFileSync(`${out}.html`, 'utf8')).toBe(toHtml(report));
    expect(readFileSync(`${out}.acr.md`, 'utf8')).toBe(toAcrMarkdown(report));
  });

  it('prints Markdown to stdout without --out', async () => {
    const { code, stdout } = await runCli(['--from', saved]);
    expect(code).toBe(0);
    expect(stdout).toBe(toMarkdown(report) + '\n');
  });

  it('gates with --fail-on, and only on new findings with --baseline', async () => {
    const gated = await runCli(['--from', saved, '--fail-on', 'serious']);
    expect(gated.code).toBe(1);
    expect(gated.stderr).toContain('Failing: found violation(s)');

    const baselined = await runCli(['--from', saved, '--baseline', saved, '--fail-on', 'serious']);
    expect(baselined.stderr).toContain('0 new · 0 fixed · 2 unchanged');
    expect(baselined.code).toBe(0);
  });

  it('refuses scan options, naming them', async () => {
    const { code, stderr } = await runCli(['--from', saved, '--route', '/home', '--keyboard']);
    expect(code).toBe(2);
    expect(stderr).toContain("--route, --keyboard can't be used with it");
  });

  it('refuses --walkthrough, which needs a scan', async () => {
    const { code, stderr } = await runCli(['--from', saved, '--walkthrough']);
    expect(code).toBe(2);
    expect(stderr).toContain("--walkthrough can't be used with it");
  });

  it('names only --serve, not a defaulted --base, when --serve is used with it', async () => {
    const { code, stderr } = await runCli(['--from', saved, '--serve', 'npx ng serve']);
    expect(code).toBe(2);
    expect(stderr).toContain("so --serve can't be used with it");
  });

  it('refuses a file that is not a JSON report', async () => {
    const md = join(dir, 'report.md');
    writeFileSync(md, toMarkdown(report));
    const { code, stderr } = await runCli(['--from', md]);
    expect(code).toBe(2);
    expect(stderr).toContain(`Can't use --from ${md}: not valid JSON`);
  });

  it('says when the worksheet uses a different axe-core than the scan did', async () => {
    const older = join(dir, 'older.json');
    writeFileSync(older, toJson({ ...report, checks: { ...report.checks!, axeVersion: '4.9.0' } }));
    const { code, stderr } = await runCli(['--from', older, '--out', join(dir, 'older'), '--format', 'acr']);
    expect(code).toBe(0);
    expect(stderr).toContain(`the scan ran axe-core 4.9.0; the worksheet's rule lists come from the installed axe-core ${axeVersion()}`);
  });

  it('says when an old report has no record of what was checked', async () => {
    const noChecks = join(dir, 'no-checks.json');
    writeFileSync(noChecks, toJson({ ...report, checks: undefined }));
    const { code, stderr } = await runCli(['--from', noChecks, '--out', join(dir, 'no-checks'), '--format', 'acr-md']);
    expect(code).toBe(0);
    expect(stderr).toContain("doesn't record what was checked");
  });
});
