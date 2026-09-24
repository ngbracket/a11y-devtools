import type { ContextObject, RunOptions } from 'axe-core';
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
  resolveDirectiveNames,
} from './attribution.js';
import { OVERLAY_EXCLUDE_SELECTOR } from './overlay.js';
import { scanKeyboard } from './keyboard/keyboard-scan.js';

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical' | null;

/** Attribution options for a scan (separate from axe's own run options). */
export interface ScanOptions {
  /**
   * Component-name prefixes treated as third-party UI primitives to walk past
   * during attribution. Defaults to {@link DEFAULT_FRAMEWORK_PREFIXES}
   * (`Nb`/`Mat`/`Cdk`/`Mdc`). Pass `[]` to disable walking and attribute to the
   * immediate owner — useful when scanning a component library's own code.
   */
  frameworkPrefixes?: readonly string[];
  /**
   * Also run the keyboard layer (part B): heuristic, `window.ng`-driven checks
   * axe can't do — keyboard-unreachable interactive controls, click handlers
   * with no keyboard handler, and visual-vs-tab-order mismatches. Emitted as
   * `ngbr/*` findings alongside the axe violations. Default false.
   */
  keyboard?: boolean;
}

/** One axe violation node, enriched with the component that rendered it. */
export interface A11yFinding {
  /** axe rule id, e.g. `image-alt`. */
  id: string;
  impact: Impact;
  help: string;
  helpUrl: string;
  /** Owning component name, or null when attribution isn't available (prod). */
  component: string | null;
  /** Owning components from the flagged node up to the root, nearest first; [] in prod. */
  componentPath: string[];
  /** Directives on the flagged node (incl. hostDirectives); [] when none/unavailable. */
  directives: string[];
  /** CSS selector axe reported for the node. */
  target: string;
  html: string;
}

// axe-core is a singleton and throws if a run starts while another is in flight.
// Chain runs so overlapping callers (e.g. rapid rescans) serialize safely.
let runChain: Promise<unknown> = Promise.resolve();

/**
 * Run axe over `root` and return findings enriched with owning component names.
 * axe-core is loaded via dynamic import so a prod build never pulls it into the
 * main bundle (the provider also no-ops outside dev mode). Concurrent calls are
 * serialized because axe cannot run more than once at a time.
 */
export function scan(
  root: Element | Document = document,
  options?: RunOptions,
  scanOptions?: ScanOptions,
): Promise<A11yFinding[]> {
  const result = runChain.then(() => runAxeOnce(root, options, scanOptions));
  runChain = result.catch(() => undefined);
  return result;
}

async function runAxeOnce(
  root: Element | Document,
  options?: RunOptions,
  scanOptions?: ScanOptions,
): Promise<A11yFinding[]> {
  const axe = (await import('axe-core')).default;
  const frameworkPrefixes = scanOptions?.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  // Scan within `root` but never flag the overlay's own highlights.
  const context: ContextObject = { include: root, exclude: [OVERLAY_EXCLUDE_SELECTOR] };
  const results = await axe.run(context, options ?? {});
  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);

  const findings: A11yFinding[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const target = Array.isArray(node.target) ? String(node.target[0]) : String(node.target);
      let element: Element | null = null;
      try {
        element = doc.querySelector(target);
      } catch {
        element = null;
      }
      const componentPath = element ? resolveComponentPath(element) : [];
      findings.push({
        id: violation.id,
        impact: (violation.impact ?? null) as Impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        component: appComponentFromPath(componentPath, frameworkPrefixes),
        componentPath,
        directives: element ? resolveDirectiveNames(element) : [],
        target,
        html: node.html,
      });
    }
  }

  // The keyboard layer runs over the same root, in the page, and appends its own
  // `ngbr/*` findings so they group and report exactly like the axe ones.
  if (scanOptions?.keyboard) {
    findings.push(...scanKeyboard(root, { frameworkPrefixes }));
  }
  return findings;
}
