#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import {
  diffAgainstBaseline,
  parseBaseline,
  scanPages,
  toHtml,
  toJson,
  toMarkdown,
} from '../dist/report/index.js';

const USAGE = `ngbr-a11y-report — component-attributed a11y scan of a running Angular dev build

Usage:
  ngbr-a11y-report --base <url> --route <path> [--route <path> ...] [options]

Options:
  --base <url>       Origin of the running dev server (e.g. http://localhost:4200)
  --route <path>     Route to scan; repeat for multiple routes
  --tags <list>      Comma-separated axe tags to scope the ruleset (e.g. wcag22aa,best-practice)
  --out <prefix>     Write <prefix>.md / .json / .html (default: print Markdown to stdout)
  --format <list>    Comma-separated: md, json, html — or both (= md,json) or all
                     (default: both when --out is set)
  --wait <ms>        Settle time after load before scanning (default 1500)
  --fail-on <impact> Exit non-zero if any finding is at/above impact
                     (minor | moderate | serious | critical) — for CI gating.
                     With --baseline, only NEW findings count
  --baseline <file>  Compare with a previous run's JSON report (from --out) and
                     mark what's new, fixed and unchanged — so CI can fail only
                     on regressions while known issues are worked down
  --framework-prefixes <list>
                     Comma-separated component-name prefixes to treat as
                     third-party UI primitives to walk past during attribution
                     (default: Nb,Mat,Cdk,Mdc). e.g. Nb,Mat,Nz,Clr,Ion
  --no-skip-primitives
                     Attribute to the immediate owner (skip nothing) — use when
                     scanning a component library's own code
  --keyboard         Also run the keyboard layer: heuristic ngbr/* findings for
                     keyboard-unreachable controls, click-without-keyboard
                     handlers, and visual-vs-tab-order mismatches
  --focus-traps      Also walk each route with real Tab presses to find keyboard
                     traps — focus that cycles inside part of the page and
                     never moves on (ngbr/focus-trap). Runs after the scan
  --headed           Launch a visible browser (debugging)
  -h, --help         Show this help
`;

const IMPACT_RANK = { minor: 1, moderate: 2, serious: 3, critical: 4 };

function parseArgs(argv) {
  const opts = { routes: [], format: 'both' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--base': opts.base = next(); break;
      case '--route': opts.routes.push(next()); break;
      case '--tags': opts.tags = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--out': opts.out = next(); break;
      case '--format': opts.format = next(); break;
      case '--wait': opts.wait = Number(next()); break;
      case '--fail-on': opts.failOn = next(); break;
      case '--baseline': opts.baseline = next(); break;
      case '--framework-prefixes':
        opts.frameworkPrefixes = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--no-skip-primitives': opts.frameworkPrefixes = []; break;
      case '--keyboard': opts.keyboard = true; break;
      case '--focus-traps': opts.focusTraps = true; break;
      case '--headed': opts.headed = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: console.error(`Unknown argument: ${arg}\n`); opts.help = true;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help || !opts.base || opts.routes.length === 0) {
  process.stderr.write(USAGE);
  process.exit(opts.help ? 0 : 1);
}

const FORMATS = { md: ['md'], json: ['json'], html: ['html'], both: ['md', 'json'], all: ['md', 'json', 'html'] };
const formats = new Set();
for (const name of String(opts.format).split(',').map((s) => s.trim()).filter(Boolean)) {
  if (!FORMATS[name]) {
    process.stderr.write(`Invalid --format "${name}" (use md, json, html, both or all)\n`);
    process.exit(2);
  }
  FORMATS[name].forEach((f) => formats.add(f));
}

// Read the baseline before the (slow) scan, so a bad path fails fast.
let baseline;
if (opts.baseline) {
  try {
    baseline = parseBaseline(readFileSync(opts.baseline, 'utf8'));
  } catch (err) {
    process.stderr.write(`Can't use --baseline ${opts.baseline}: ${err.message}\n`);
    process.exit(2);
  }
}

const report = await scanPages({
  baseUrl: opts.base,
  routes: opts.routes,
  tags: opts.tags,
  waitMs: opts.wait,
  headed: opts.headed,
  frameworkPrefixes: opts.frameworkPrefixes,
  keyboard: opts.keyboard,
  focusTraps: opts.focusTraps,
});

const allFindings = report.pages.flatMap((p) => p.findings);
process.stderr.write(
  `Scanned ${report.pages.length} route(s) · ${allFindings.length} node-instance(s).\n`,
);
const diff = baseline ? diffAgainstBaseline(report, baseline) : undefined;
if (diff) {
  process.stderr.write(
    `Compared with baseline: ${diff.added.length} new · ${diff.fixed.length} fixed · ${diff.unchanged} unchanged.\n`,
  );
}
if (allFindings.length > 0 && allFindings.every((f) => f.component === null)) {
  process.stderr.write(
    'Note: no component attribution (window.ng absent) — is this a production build? Report mode names components only against a dev build.\n',
  );
}

if (!opts.out) {
  process.stdout.write(toMarkdown(report, diff) + '\n');
} else {
  const render = { md: toMarkdown, json: toJson, html: toHtml };
  for (const format of formats) {
    writeFileSync(`${opts.out}.${format}`, render[format](report, diff));
    process.stderr.write(`Wrote ${opts.out}.${format}\n`);
  }
}

if (opts.failOn) {
  const threshold = IMPACT_RANK[opts.failOn];
  if (!threshold) {
    process.stderr.write(`Invalid --fail-on "${opts.failOn}" (use minor|moderate|serious|critical)\n`);
    process.exit(2);
  }
  // With a baseline, only regressions fail the gate; known issues don't.
  const gated = diff ? diff.added.map((a) => a.finding) : allFindings;
  const worst = gated.reduce((max, f) => Math.max(max, IMPACT_RANK[f.impact] ?? 0), 0);
  if (worst >= threshold) {
    const which = diff ? 'new violation(s)' : 'violation(s)';
    process.stderr.write(`Failing: found ${which} at or above "${opts.failOn}".\n`);
    process.exit(1);
  }
}
