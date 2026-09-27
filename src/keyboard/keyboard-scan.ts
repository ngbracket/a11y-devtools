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
  hasFocusableDescendant,
  hasTabbableDescendant,
  isHidden,
  isNativelyFocusable,
  isTabbable,
  tabSequence,
  visualOrderJumps,
} from './tab-sequence.js';
import { findUncontainedModals } from './focus-trap.js';
import { blockingModalDialog } from '../top-layer.js';

export interface KeyboardScanOptions {
  /** UI-primitive prefixes to walk past during attribution; see the scan options. */
  frameworkPrefixes?: readonly string[];
  /** Visibility predicate override (tests); see {@link tabSequence}. */
  isVisible?: (element: Element) => boolean;
  /** Modal-dialog check override (tests; jsdom has no `:modal`). See {@link tabSequence}. */
  isModal?: (element: Element) => boolean;
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

/**
 * Composite widgets: Tab reaches the widget once, and arrow keys move between
 * its items (WAI-ARIA APG "Keyboard navigation inside components").
 */
const COMPOSITE_SELECTOR = ['tablist', 'toolbar', 'menu', 'menubar', 'radiogroup', 'listbox', 'tree', 'treegrid', 'grid']
  .map((role) => `[role="${role}"]`)
  .join(',');

/**
 * True when `element` is an item that its composite widget reaches with arrow
 * keys, so Tab skipping it is correct:
 * - **aria-activedescendant**: focus stays on the widget (or on a combobox that
 *   controls it) and points at the item; or
 * - **roving tabindex**: the item has a tabindex (usually -1), so script can
 *   focus it, and Tab can get into the widget: one of its items is tabbable,
 *   the widget itself is, or another element controls it (a menu or listbox
 *   popup, which gets focus when it opens).
 * An item with neither, or a widget Tab can't enter at all, is still reported.
 */
function reachedWithinWidget(element: Element, isVisible?: (el: Element) => boolean): boolean {
  const widget = element.parentElement?.closest(COMPOSITE_SELECTOR);
  if (!widget) return false;
  const controllers = widget.id
    ? [...(widget.ownerDocument ?? document).querySelectorAll('[aria-controls], [aria-owns]')].filter((el) =>
        `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`
          .split(/\s+/)
          .includes(widget.id),
      )
    : [];
  if ([widget, ...controllers].some((el) => el.hasAttribute('aria-activedescendant'))) return true;

  const tabindex = element.getAttribute('tabindex');
  if (tabindex === null || Number.isNaN(Number.parseInt(tabindex, 10))) return false;
  return isTabbable(widget, isVisible) || controllers.length > 0 || hasTabbableDescendant(widget, isVisible);
}

const ITEM_SELECTOR = [...INTERACTIVE_ROLES].map((role) => `[role="${role}"]`).join(',');

/**
 * True when `element` is a click-only part of something the keyboard already
 * operates, so the click is a mouse shortcut, not a control of its own:
 * - a composite-widget item that the keyboard can reach, such as a tree's
 *   expand/collapse arrow inside its treeitem (←/→ on the treeitem); or
 * - the nearest Tab-reachable ancestor that handles keys itself, such as a
 *   chart's bars inside a focusable chart that moves between them with arrow
 *   keys. `<body>` is never tabbable, so a page-wide shortcut listener doesn't
 *   count.
 */
function partOfKeyboardOperatedWidget(element: Element, isVisible?: (el: Element) => boolean): boolean {
  const item = element.parentElement?.closest(ITEM_SELECTOR);
  if (item?.parentElement?.closest(COMPOSITE_SELECTOR)) {
    if (isTabbable(item, isVisible) || reachedWithinWidget(item, isVisible)) return true;
  }
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (!isTabbable(el, isVisible)) continue;
    return resolveListenerEvents(el).some((e) => KEY_EVENTS.includes(e));
  }
  return false;
}

/**
 * Each rule's page: what the message means, who it affects, exactly what
 * triggers it, how to fix and check it, and the WCAG/APG reference.
 */
export const RULE_DOCS = 'https://ngbracket.com/tools/a11y-devtools/docs';

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

  // While a modal <dialog> is open the page behind it is inert: not reachable,
  // and not something to report on (axe skips it too). Only check the modal.
  const doc = root instanceof Document ? root : (root as Node).ownerDocument;
  const modal = doc ? blockingModalDialog(doc, options.isModal) : null;

  for (const element of root.querySelectorAll('*')) {
    if (modal && !modal.contains(element)) continue;
    // Native controls are keyboard-reachable and activate on Enter/Space on their
    // own, so they can't be the subject of either finding — skip them outright.
    if (isNativelyFocusable(element)) continue;

    const role = element.getAttribute('role')?.toLowerCase() ?? '';
    const events = resolveListenerEvents(element);
    const hasClick = events.includes('click');
    const interactiveByRole = INTERACTIVE_ROLES.has(role);
    if (!hasClick && !interactiveByRole) continue; // nothing marks this as interactive
    // A click listener on a container of links/controls (no interactive role of
    // its own) is event delegation, not a control — the controls inside are what
    // the keyboard reaches.
    if (!interactiveByRole && hasFocusableDescendant(element)) continue;
    // Hidden (a closed <details>, [hidden], display:none): not reachable because
    // it isn't shown. Check it when it is.
    if (isHidden(element, isVisible)) continue;
    if (!interactiveByRole && partOfKeyboardOperatedWidget(element, isVisible)) continue;

    const focusable = isTabbable(element, isVisible);

    if (!focusable) {
      if (interactiveByRole && reachedWithinWidget(element, isVisible)) continue;
      const reason = interactiveByRole ? `has role="${role}"` : 'has a click handler';
      findings.push(
        make(
          element,
          'ngbr/unreachable-control',
          'serious',
          `Keyboard users can't reach this control: it ${reason}, but it isn't a native ` +
            `control and has no tabindex="0", so Tab skips it. Use a <button> or <a href>, ` +
            `or add tabindex="0" and Enter/Space handling.`,
          `${RULE_DOCS}/unreachable-control`,
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
          `Keyboard users may not be able to activate this: Tab reaches it, but it only ` +
            `listens for click, and Enter and Space don't fire click on a non-native element. ` +
            `Use a <button>, or handle Enter and Space too. Heuristic — verify manually.`,
          `${RULE_DOCS}/click-without-key`,
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
        `Keyboard users can Tab out of this modal: it has aria-modal="true", but ` +
          `${modal.outsideCount} control(s) outside it can still be reached with Tab. Open it ` +
          `with <dialog>.showModal(), make the rest of the page inert, or trap focus. ` +
          `Heuristic — verify manually.`,
        `${RULE_DOCS}/modal-focus-not-contained`,
      ),
    );
  }

  // Visual-vs-tab-order mismatch: a heuristic over the resolved sequence. Needs
  // real layout, so it no-ops where getBoundingClientRect returns zeros (jsdom).
  const stops = tabSequence(root, { frameworkPrefixes: prefixes, isVisible, isModal: options.isModal });
  for (const jump of visualOrderJumps(stops)) {
    const stop = stops[jump];
    findings.push(
      make(
        stop.element,
        'ngbr/tab-order-mismatch',
        'moderate',
        `Tab order jumps backwards here: Tab reaches this control (stop ${stop.order}) after ` +
          `one that sits below it or to its right, so focus moves against the reading order. ` +
          `Heuristic — check the order makes sense to a sighted keyboard user.`,
        `${RULE_DOCS}/tab-order-mismatch`,
      ),
    );
  }

  return findings;
}
