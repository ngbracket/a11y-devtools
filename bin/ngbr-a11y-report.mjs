#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { scanPages, toJson, toMarkdown } from '../dist/report/index.js';

const USAGE = `ngbr-a11y-report — component-attributed a11y scan of a running Angular dev build

Usage:
  ngbr-a11y-report --base <url> --route <path> [--route <path> ...] [options]

Options:
  --base <url>       Origin of the running dev server (e.g. http://localhost:4200)
  --route <path>     Route to scan; repeat for multiple routes
  --tags <list>      Comma-separated axe tags to scope the ruleset (e.g. wcag22aa,best-practice)
  --out <prefix>     Write <prefix>.md / <prefix>.json (default: print Markdown to stdout)
  --format <fmt>     md | json | both (default: both when --out is set)
  --wait <ms>        Settle time after load before scanning (default 1500)
  --fail-on <impact> Exit non-zero if any finding is at/above impact
                     (minor | moderate | serious | critical) — for CI gating
  --framework-prefixes <list>
                     Comma-separated component-name prefixes to treat as
                     third-party UI primitives to walk past during attribution
                     (default: Nb,Mat,Cdk,Mdc). e.g. Nb,Mat,Nz,Clr,Ion
  --no-skip-primitives
                     Attribute to the immediate owner (skip nothing) — use when
                     scanning a component library's own code
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
      case '--framework-prefixes':
        opts.frameworkPrefixes = next().split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case '--no-skip-primitives': opts.frameworkPrefixes = []; break;
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

const report = await scanPages({
  baseUrl: opts.base,
  routes: opts.routes,
  tags: opts.tags,
  waitMs: opts.wait,
  headed: opts.headed,
  frameworkPrefixes: opts.frameworkPrefixes,
});

const allFindings = report.pages.flatMap((p) => p.findings);
process.stderr.write(
  `Scanned ${report.pages.length} route(s) · ${allFindings.length} node-instance(s).\n`,
);
if (allFindings.length > 0 && allFindings.every((f) => f.component === null)) {
  process.stderr.write(
    'Note: no component attribution (window.ng absent) — is this a production build? Report mode names components only against a dev build.\n',
  );
}

if (!opts.out) {
  process.stdout.write(toMarkdown(report) + '\n');
} else {
  const format = opts.format ?? 'both';
  if (format === 'md' || format === 'both') {
    writeFileSync(`${opts.out}.md`, toMarkdown(report));
    process.stderr.write(`Wrote ${opts.out}.md\n`);
  }
  if (format === 'json' || format === 'both') {
    writeFileSync(`${opts.out}.json`, toJson(report));
    process.stderr.write(`Wrote ${opts.out}.json\n`);
  }
}

if (opts.failOn) {
  const threshold = IMPACT_RANK[opts.failOn];
  if (!threshold) {
    process.stderr.write(`Invalid --fail-on "${opts.failOn}" (use minor|moderate|serious|critical)\n`);
    process.exit(2);
  }
  const worst = report.pages
    .flatMap((p) => p.findings)
    .reduce((max, f) => Math.max(max, IMPACT_RANK[f.impact] ?? 0), 0);
  if (worst >= threshold) {
    process.stderr.write(`Failing: found violation(s) at or above "${opts.failOn}".\n`);
    process.exit(1);
  }
}
