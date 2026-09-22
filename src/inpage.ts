import type { RunOptions as AxeRunOptions } from 'axe-core';
import { scan, type A11yFinding } from './scan.js';

/**
 * The browser-injected half of report-mode. A headless driver injects the built
 * IIFE (`dist/inpage.global.js`) into a running **dev** page and calls this
 * global; because it runs *in the page*, `window.ng` is live and `scan()`
 * attributes each violation to its owning component — no change to the target app.
 *
 * This entry is deliberately NOT re-exported from `index.ts`: it bundles axe-core
 * and must never reach a consumer's application bundle.
 */
export type InPageScan = (options?: AxeRunOptions) => Promise<A11yFinding[]>;

const run: InPageScan = (options) => scan(document, options);

(globalThis as unknown as { __ngbA11yScan: InPageScan }).__ngbA11yScan = run;
