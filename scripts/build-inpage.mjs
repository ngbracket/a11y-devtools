import { build } from 'esbuild';

/**
 * Bundle the in-page scan entry into a single self-contained IIFE that a headless
 * driver injects into a running dev page. We bundle the *compiled* `dist/inpage.js`
 * (not `src/inpage.ts`) so its `./scan.js` / `./attribution.js` specifiers resolve
 * against real emitted files — run this after `tsc`. axe-core is bundled in on
 * purpose: this artifact is injected in a headless browser, never shipped to an app,
 * so the "axe stays out of the consumer bundle" invariant is unaffected.
 */
await build({
  entryPoints: ['dist/inpage.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/inpage.global.js',
  // The package is `sideEffects: false`, but inpage's whole job is a side effect
  // (assigning `globalThis.__ngbA11yScan`). Disable tree-shaking so it survives.
  treeShaking: false,
  logLevel: 'info',
});
