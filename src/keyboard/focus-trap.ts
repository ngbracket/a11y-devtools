/**
 * The keyboard layer, part D (M3): focus-trap detection. This first landing does
 * the *missing-trap* half — an open modal that fails to contain focus — because
 * it's deterministic and reuses the M1 tab-order machinery directly. The
 * *bad-trap* half ("you can Tab in but never Tab out") needs real Tab key presses
 * to observe, so it belongs in headless report-mode (Playwright) and is a
 * separate follow-up.
 *
 * HONESTY GUARDRAIL: these are *candidates*, not verdicts — a modal may be
 * intentionally non-modal, so findings say "verify manually".
 */
import { tabSequence, type TabSequenceOptions } from './tab-sequence.js';

/** An open `aria-modal` whose focus isn't contained, with the leak counts. */
export interface UncontainedModal {
  /** The `aria-modal="true"` element. */
  element: Element;
  /** Tabbable stops inside the modal. */
  insideCount: number;
  /** Tabbable stops outside the modal that are still reachable (the leak). */
  outsideCount: number;
}

/**
 * Open modals (`aria-modal="true"`) whose focus is **not** contained: while the
 * modal is open, tabbable elements outside it are still reachable, so a keyboard
 * user can Tab out to the page behind. Reuses {@link tabSequence} — which already
 * drops `inert`/hidden/disabled subtrees — so a modal that correctly marks the
 * background `inert` produces no outside stops and is *not* flagged. A modal with
 * no tabbable content of its own is skipped (nothing to trap).
 */
export function findUncontainedModals(
  root: ParentNode = document,
  options: TabSequenceOptions = {},
): UncontainedModal[] {
  // A modal kept in by a JS focus trap (CDK/Material) comes back from
  // tabSequence with only its own stops, so it has no leak and isn't flagged.
  const stops = tabSequence(root, options);
  if (stops.length === 0) return [];

  const results: UncontainedModal[] = [];
  for (const modal of root.querySelectorAll('[aria-modal="true"]')) {
    let insideCount = 0;
    let outsideCount = 0;
    for (const stop of stops) {
      if (modal.contains(stop.element)) insideCount++;
      else outsideCount++;
    }
    if (insideCount > 0 && outsideCount > 0) results.push({ element: modal, insideCount, outsideCount });
  }
  return results;
}
