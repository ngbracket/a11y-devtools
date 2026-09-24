/**
 * The keyboard layer, part B: findings axe can't produce, because they depend on
 * runtime state axe never sees — which elements actually have a DOM `click`
 * listener (read from Angular's `window.ng.getListeners`) and whether the tab
 * path matches the visual order. These are emitted as {@link A11yFinding}s with
 * synthetic `ngbr/*` rule ids, so they flow through the same grouped console
 * output, overlay, and report as the axe violations — attributed to the owning
 * component like everything else.
 *
 * Honesty guardrail: these are *heuristics*, not axe rules. `click-without-key`
 * and `tab-order-mismatch` are flagged as candidates to verify by hand, never as
 * confirmed failures.
 */
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
  resolveDirectiveNames,
  resolveListenerEvents,
} from '../attribution.js';
import type { A11yFinding } from '../scan.js';
import {
  isNativelyFocusable,
  isTabbable,
  tabSequence,
  visualOrderJumps,
} from './tab-sequence.js';
import { findUncontainedModals } from './focus-trap.js';

export interface KeyboardScanOptions {
  /** UI-primitive prefixes to walk past during attribution; see the scan options. */
  frameworkPrefixes?: readonly string[];
  /** Visibility predicate override (tests); see {@link tabSequence}. */
  isVisible?: (element: Element) => boolean;
}

/** WAI-ARIA roles that make a non-native element behave as an interactive control. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'checkbox',
  'radio',
  'option',
  'slider',
  'spinbutton',
  'combobox',
  'textbox',
  'searchbox',
  'treeitem',
]);

const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding';
const KEYBOARD_URL = `${UNDERSTANDING}/keyboard.html`;
const FOCUS_ORDER_URL = `${UNDERSTANDING}/focus-order.html`;
const DIALOG_MODAL_URL = 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/';

/** A short, human CSS-ish selector for our own findings (not an axe target). */
export function shortSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const classes = (element.getAttribute('class') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return classes.length ? `${tag}.${classes.join('.')}` : tag;
}

/** Truncated outerHTML for a finding's `html`. */
export function shortHtml(element: Element): string {
  const html = element.outerHTML ?? '';
  return html.length > 160 ? `${html.slice(0, 159)}…` : html;
}

/**
 * Scan `root` for keyboard-operability problems and return them as findings.
 * Runs entirely in the page (needs the live `window.ng` for listeners and
 * attribution), so it's a no-op — empty result — in production where that global
 * is absent.
 */
export function scanKeyboard(
  root: ParentNode = document,
  options: KeyboardScanOptions = {},
): A11yFinding[] {
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  const isVisible = options.isVisible;
  const findings: A11yFinding[] = [];

  const make = (
    element: Element,
    id: string,
    impact: A11yFinding['impact'],
    help: string,
    helpUrl: string,
  ): A11yFinding => {
    const componentPath = resolveComponentPath(element);
    return {
      id,
      impact,
      help,
      helpUrl,
      component: appComponentFromPath(componentPath, prefixes),
      componentPath,
      directives: resolveDirectiveNames(element),
      target: shortSelector(element),
      html: shortHtml(element),
    };
  };

  for (const element of root.querySelectorAll('*')) {
    // Native controls are keyboard-reachable and activate on Enter/Space on their
    // own, so they can't be the subject of either finding — skip them outright.
    if (isNativelyFocusable(element)) continue;

    const role = element.getAttribute('role')?.toLowerCase() ?? '';
    const events = resolveListenerEvents(element);
    const hasClick = events.includes('click');
    const interactiveByRole = INTERACTIVE_ROLES.has(role);
    if (!hasClick && !interactiveByRole) continue; // nothing marks this as interactive

    const focusable = isTabbable(element, isVisible);

    if (!focusable) {
      const reason = interactiveByRole ? `has role="${role}"` : 'has a click handler';
      findings.push(
        make(
          element,
          'ngbr/unreachable-control',
          'serious',
          `Interactive element isn't reachable by keyboard — it ${reason} but is not a ` +
            `native control and has no tabindex >= 0, so keyboard and screen-reader users ` +
            `can't focus it. Add tabindex="0" (and a role, if missing), or use a <button>/<a>.`,
          KEYBOARD_URL,
        ),
      );
      continue; // don't also report a weaker click-without-key on the same node
    }

    // Focusable, but a bare (click) never fires on Enter/Space the way a native
    // button does — so a keyboard user can reach it and still not activate it.
    const hasKey = events.some((e) => KEY_EVENTS.includes(e));
    if (hasClick && !hasKey) {
      findings.push(
        make(
          element,
          'ngbr/click-without-key',
          'moderate',
          `Possible keyboard trap: this element has a (click) handler but no keyboard ` +
            `handler (keydown/keyup) and isn't a native button/link, so Enter/Space may not ` +
            `activate it. Verify by hand, then add a key handler or use a <button>.`,
          KEYBOARD_URL,
        ),
      );
    }
  }

  // Missing focus trap (M3): an open aria-modal whose focus isn't contained.
  // Reuses the tab-order machinery (inert/hidden already excluded), so a modal
  // that correctly inerts the background is not flagged.
  for (const modal of findUncontainedModals(root, { frameworkPrefixes: prefixes, isVisible })) {
    findings.push(
      make(
        modal.element,
        'ngbr/modal-focus-not-contained',
        'moderate',
        `Possible missing focus trap: this element has aria-modal="true", but ` +
          `${modal.outsideCount} tabbable element(s) outside it are still reachable, so a keyboard ` +
          `user can Tab out of the modal to the page behind. Mark the background inert or trap ` +
          `focus within the dialog. Heuristic — verify manually.`,
        DIALOG_MODAL_URL,
      ),
    );
  }

  // Visual-vs-tab-order mismatch: a heuristic over the resolved sequence. Needs
  // real layout, so it no-ops where getBoundingClientRect returns zeros (jsdom).
  const stops = tabSequence(root, { frameworkPrefixes: prefixes, isVisible });
  for (const jump of visualOrderJumps(stops)) {
    const stop = stops[jump];
    findings.push(
      make(
        stop.element,
        'ngbr/tab-order-mismatch',
        'moderate',
        `Possible tab-order mismatch: Tab reaches this control (stop ${stop.order}) after ` +
          `one that sits below or to the right of it, so focus jumps against the visual ` +
          `reading order. Heuristic — verify the order makes sense for a sighted keyboard user.`,
        FOCUS_ORDER_URL,
      ),
    );
  }

  return findings;
}
