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
  --headed           Launch a visible browser (debugging)
  -h, --help         Show this help
`;

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
});

const total = report.pages.reduce((n, p) => n + p.findings.length, 0);
process.stderr.write(
  `Scanned ${report.pages.length} route(s) · ${total} node-instance(s).\n`,
);

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
