import type { RunOptions } from 'axe-core';
import { resolveOwningComponentName } from './attribution';

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical' | null;

/** One axe violation node, enriched with the component that rendered it. */
export interface A11yFinding {
  /** axe rule id, e.g. `image-alt`. */
  id: string;
  impact: Impact;
  help: string;
  helpUrl: string;
  /** Owning component name, or null when attribution isn't available (prod). */
  component: string | null;
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
): Promise<A11yFinding[]> {
  const result = runChain.then(() => runAxeOnce(root, options));
  runChain = result.catch(() => undefined);
  return result;
}

async function runAxeOnce(
  root: Element | Document,
  options?: RunOptions,
): Promise<A11yFinding[]> {
  const axe = (await import('axe-core')).default;
  const results = await axe.run(root as Element, options ?? {});
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
      findings.push({
        id: violation.id,
        impact: (violation.impact ?? null) as Impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        component: element ? resolveOwningComponentName(element) : null,
        target,
        html: node.html,
      });
    }
  }
  return findings;
}
