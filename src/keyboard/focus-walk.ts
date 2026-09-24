/**
 * The keyboard layer, part D (M3 part 2): *bad* focus-trap detection — "you can
 * Tab in, but never Tab out" (WCAG 2.1.2 No Keyboard Trap). Unlike the other
 * keyboard checks this can't be read off the DOM: a trap is made by script that
 * intercepts Tab or re-focuses on blur, and synthetic key events don't move focus
 * in a browser. So report-mode drives **real** Tab presses (Playwright) and the
 * walk is split in two:
 *
 * - {@link detectTabTrap} — pure: given the sequence of focused elements the walk
 *   observed, decide whether focus completed a full lap, is still going, or is
 *   cycling inside a subset of the page (a trap). Runs in Node; unit-tested.
 * - {@link createFocusWalkProbe} — in-page: gives each focused element a stable
 *   id for the walk, and turns a detected cycle into an attributed finding.
 *
 * HONESTY GUARDRAIL: a candidate, not a verdict. Some widgets legitimately keep
 * Tab (a code editor, a modal) and are fine if they document another exit — so
 * the finding says "verify manually", and focus cycling inside an open modal is
 * not reported at all (that's containment working; the missing-trap check covers
 * a modal that leaks).
 */
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
  resolveDirectiveNames,
} from '../attribution.js';
import type { A11yFinding } from '../scan.js';
import { shortHtml, shortSelector } from './keyboard-scan.js';
import { tabSequence } from './tab-sequence.js';

/** One observation from the walk: a focused element's id, or null when focus is on `<body>`/nothing. */
export type FocusObservation = number | null;

/** Outcome of {@link detectTabTrap} over the observations so far. */
export type TabWalkVerdict =
  /** Focus wrapped past the end of the page and came back round — no trap. */
  | { kind: 'complete' }
  /** Focus is cycling through `cycle` (element ids, in order) without ever leaving. */
  | { kind: 'trap'; cycle: number[] }
  /** Not enough evidence yet — keep pressing Tab. */
  | { kind: 'pending' };

/**
 * Classify a Tab walk. Browsers pass focus through `<body>` (null here) when Tab
 * wraps off the end of the page, so an element seen again *after* a null means
 * focus made a full lap; seen again with no null in between means it looped
 * inside part of the page — a trap. The walk may start mid-page (wherever the
 * browser's navigation starting point is), which this handles for free.
 *
 * Consecutive repeats of an `iframe` are the browser tabbing *inside* the frame
 * (the parent document only ever sees the frame element), so callers pass
 * `collapsible` ids to skip those rather than read them as a trap.
 */
export function detectTabTrap(
  observations: readonly FocusObservation[],
  collapsible: ReadonlySet<number> = new Set(),
): TabWalkVerdict {
  const seq: FocusObservation[] = [];
  for (const obs of observations) {
    const prev = seq[seq.length - 1];
    if (obs !== null && obs === prev && collapsible.has(obs)) continue;
    seq.push(obs);
  }

  const lastSeen = new Map<number, number>();
  for (let i = 0; i < seq.length; i++) {
    const id = seq[i];
    if (id === null) continue;
    const before = lastSeen.get(id);
    if (before !== undefined) {
      const between = seq.slice(before, i);
      if (between.includes(null)) return { kind: 'complete' };
      return { kind: 'trap', cycle: between as number[] };
    }
    lastSeen.set(id, i);
  }
  return { kind: 'pending' };
}

/** In-page half of the walk; installed on `window` by the report-mode bundle. */
export interface FocusWalkProbe {
  /**
   * The currently focused element's walk id (drilling into open shadow roots),
   * or null when focus is on `<body>`/nothing. `iframe` is true when the focused
   * element is a frame, whose inner Tab stops the parent can't see.
   */
  probe(): { id: FocusObservation; iframe: boolean };
  /** Number of tabbable stops in the page, for sizing the walk. */
  stopCount(): number;
  /**
   * Build the finding for a detected cycle, or null when the cycle is focus
   * correctly contained in an open modal. `shiftTabEscapes` records whether
   * Shift+Tab got out (it lowers the impact but it's still a problem).
   */
  trapFinding(cycle: readonly number[], shiftTabEscapes: boolean): A11yFinding | null;
}

const NO_KEYBOARD_TRAP_URL = 'https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html';

/** The element that really has focus, through open shadow roots. */
function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** True when focus cycling among `elements` is an open modal containing focus (fine). */
function containedByOpenModal(elements: readonly Element[]): boolean {
  const modalOf = (el: Element): Element | null => {
    const aria = el.closest('[aria-modal="true"]');
    if (aria) return aria;
    try {
      return el.closest('dialog:modal');
    } catch {
      return null; // engine without :modal
    }
  };
  const first = elements[0] ? modalOf(elements[0]) : null;
  return first !== null && elements.every((el) => modalOf(el) === first);
}

/** Nearest element containing every element of the cycle. */
function commonAncestor(elements: readonly Element[]): Element {
  let candidate: Element | null = elements[0];
  while (candidate && !elements.every((el) => candidate!.contains(el))) {
    candidate = candidate.parentElement;
  }
  return candidate ?? elements[0];
}

/**
 * Create the in-page probe. Ids are assigned on first sight and held in page
 * memory only — the walk never writes to the DOM.
 */
export function createFocusWalkProbe(
  doc: Document = document,
  frameworkPrefixes: readonly string[] = DEFAULT_FRAMEWORK_PREFIXES,
): FocusWalkProbe {
  const ids = new WeakMap<Element, number>();
  const byId = new Map<number, Element>();

  return {
    probe() {
      const active = deepActiveElement(doc);
      if (!active || active === doc.body || active === doc.documentElement) {
        return { id: null, iframe: false };
      }
      let id = ids.get(active);
      if (id === undefined) {
        id = byId.size + 1;
        ids.set(active, id);
        byId.set(id, active);
      }
      return { id, iframe: active.tagName === 'IFRAME' };
    },

    stopCount() {
      return tabSequence(doc, { frameworkPrefixes }).length;
    },

    trapFinding(cycle, shiftTabEscapes) {
      const elements = [...new Set(cycle)]
        .map((id) => byId.get(id))
        .filter((el): el is Element => el !== undefined);
      if (elements.length === 0 || containedByOpenModal(elements)) return null;

      const owner = elements.length === 1 ? elements[0] : commonAncestor(elements);
      const reachable = new Set(byId.values());
      const unreached = tabSequence(doc, { frameworkPrefixes }).filter(
        (stop) => !reachable.has(stop.element),
      ).length;
      const where =
        elements.length === 1
          ? 'focus stays on this element when Tab is pressed'
          : `Tab cycles through ${elements.length} controls inside this element and never leaves`;
      const reach = unreached > 0 ? `, so ${unreached} tabbable control(s) in the page are never reached` : '';
      const shift = shiftTabEscapes
        ? ' Shift+Tab does get out, but Tab alone should too.'
        : ' Shift+Tab doesn\'t get out either.';
      const componentPath = resolveComponentPath(owner);

      return {
        id: 'ngbr/focus-trap',
        impact: shiftTabEscapes ? 'moderate' : 'serious',
        help:
          `Possible keyboard trap: ${where}${reach}.${shift} If this widget deliberately keeps ` +
          `Tab (e.g. a code editor), it must tell users how to leave (such as Escape); otherwise ` +
          `let Tab move focus on. Found by real Tab presses — verify manually.`,
        helpUrl: NO_KEYBOARD_TRAP_URL,
        component: appComponentFromPath(componentPath, frameworkPrefixes),
        componentPath,
        directives: resolveDirectiveNames(owner),
        target: shortSelector(owner),
        html: shortHtml(owner),
      };
    },
  };
}
