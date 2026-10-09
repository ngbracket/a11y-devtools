/**
 * The keyboard layer, part B: findings axe can't produce, because they depend on
 * runtime state axe never sees — which elements actually have a DOM `click`
 * listener (read from Angular's `window.ng.getListeners`) and whether the tab
 * path matches the visual order. These are emitted as {@link A11yFinding}s with
 * synthetic `ngbr/*` rule ids, so they flow through the same grouped console
 * output, overlay, and report as the axe violations — attributed to the owning
 * component like everything else.
 *
 * Honesty guardrail: these are *heuristics*, not axe rules. `click-without-key`,
 * `hover-only-content`, `drag-without-keyboard` and `tab-order-mismatch` are
 * flagged as candidates to verify by hand, never as confirmed failures.
 */
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
  resolveDirectiveNames,
  resolveListenerEvents,
  ngDebug,
} from '../attribution.js';
import type { A11yFinding } from '../scan.js';
import {
  hasFocusableDescendant,
  hasTabbableDescendant,
  isHidden,
  isDisabled,
  isNativelyFocusable,
  isTabbable,
  tabSequence,
  visualOrderJumps,
} from './tab-sequence.js';
import { findUncontainedModals } from './focus-trap.js';
import { hoverSignal, type HoverSignal } from './hover-content.js';
import { dragGroups, dragHandles, hasMoveControl } from './drag-drop.js';
import { blockingModalDialog } from '../top-layer.js';
import { OVERLAY_EXCLUDE_SELECTOR } from '../overlay.js';

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
 * True when `events` includes a key event. Angular reports a listener by the name
 * in the template, key modifiers and all (`(keydown.enter)` → `keydown.enter`),
 * so match on the event before the first dot.
 */
function hasKeyEvent(events: readonly string[]): boolean {
  return events.some((e) => KEY_EVENTS.includes(e.split('.')[0]));
}

/** True when `element` has a numeric `tabindex`, so script can focus it. */
function hasTabindex(element: Element): boolean {
  const tabindex = element.getAttribute('tabindex');
  return tabindex !== null && !Number.isNaN(Number.parseInt(tabindex, 10));
}

/**
 * Composite widgets: Tab reaches the widget once, and arrow keys move between
 * its items (WAI-ARIA APG "Keyboard navigation inside components").
 */
const COMPOSITE_SELECTOR = ['tablist', 'toolbar', 'menu', 'menubar', 'radiogroup', 'listbox', 'tree', 'treegrid', 'grid']
  .map((role) => `[role="${role}"]`)
  .join(',');

/**
 * How a composite widget's item is reached, when Tab skipping it may be correct:
 * - `'reached'`: the keyboard reaches it within the widget —
 *   **aria-activedescendant** (focus stays on the widget, or on a combobox that
 *   controls it, and points at the item), or **roving tabindex** (the item has a
 *   tabindex, usually -1, so script can focus it; Tab can get into the widget —
 *   one of its items is tabbable, the widget itself is, or another element
 *   controls it, like a menu button — and something handles keys: see
 *   {@link handlesKeys}).
 * - `'no-keys'`: set up for roving tabindex, but no key handling was found, so
 *   arrow keys may not move to it — the classic half-built tab list.
 * - `false`: not a composite item, or one Tab can't get into / script can't focus.
 *
 * Key listeners are read through Angular's dev-mode debug API. Without it (a
 * production build) nothing can be seen, so roving tabindex counts as reached.
 */
function reachedWithinWidget(
  element: Element,
  isVisible?: (el: Element) => boolean,
  keyCache: Map<Element, boolean> = new Map(),
  sharedCache: SharedStopCache = new Map(),
): 'reached' | 'no-keys' | false {
  const widget = element.parentElement?.closest(COMPOSITE_SELECTOR);
  if (!widget) return false;
  const controllers = widget.id
    ? [...(widget.ownerDocument ?? document).querySelectorAll('[aria-controls], [aria-owns]')].filter((el) =>
        `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`
          .split(/\s+/)
          .includes(widget.id),
      )
    : [];
  if ([widget, ...controllers].some((el) => el.hasAttribute('aria-activedescendant'))) return 'reached';

  const tabindex = element.getAttribute('tabindex');
  if (tabindex === null || Number.isNaN(Number.parseInt(tabindex, 10))) return false;
  const enterable =
    isTabbable(widget, isVisible) ||
    controllers.length > 0 ||
    hasTabbableDescendant(widget, isVisible) ||
    sharesRovingStop(widget, element, isVisible, sharedCache);
  if (!enterable) return false;
  if (!listenersVisible()) return 'reached';
  // Same widget, same answer: work it out once per scan, not once per item.
  let keys = keyCache.get(widget);
  if (keys === undefined) keyCache.set(widget, (keys = handlesKeys(widget, controllers)));
  return keys ? 'reached' : 'no-keys';
}

/** True when Angular's debug API can tell us which listeners an element has. */
function listenersVisible(): boolean {
  return typeof ngDebug()?.getListeners === 'function';
}

/**
 * True when something that could move focus between `widget`'s items listens
 * for keys: the widget, an element that controls it, an ancestor up to and
 * including the nearest component host (Angular Material, for one, puts a tab
 * list's keydown on a wrapper around the `role="tablist"`), or anything inside
 * the widget. The walk stops at that host so an app shell's shortcut listener
 * doesn't vouch for every widget below it.
 */
function handlesKeys(widget: Element, controllers: readonly Element[]): boolean {
  const ng = ngDebug();
  const body = widget.ownerDocument?.body;
  const ancestors: Element[] = [];
  for (let el = widget.parentElement; el && el !== body; el = el.parentElement) {
    ancestors.push(el);
    if (isComponentHost(el, ng)) break;
  }
  const keyed = (el: Element) => hasKeyEvent(resolveListenerEvents(el));
  // Cheapest first; the widget's contents (every cell of a grid) last.
  return [widget, ...controllers, ...ancestors].some(keyed) || [...widget.querySelectorAll('*')].some(keyed);
}

/**
 * True when `widget` is one of several same-role widgets that share a single
 * roving tab stop: a kanban board with a `role="listbox"` per column and one tab
 * stop for the whole board, where arrow keys cross columns. A column without the
 * current card has no tabbable item of its own, but Tab still reaches the board.
 *
 * Accepted when another widget of the same role holds a tabbable item of the
 * same role, both inside the nearest component host, AND the two are repeated
 * siblings: where their branches meet, each branch is the same element with the
 * same classes (what a `@for` over columns renders), ignoring Angular's own
 * `ng-*` classes and BEM modifiers (`--full`), which vary by state. So a working
 * listbox can't vouch for an unrelated broken one in another part of the same
 * template. Needs Angular's debug API to find the host; without it (a
 * production build) it never applies.
 */
function sharesRovingStop(
  widget: Element,
  item: Element,
  isVisible: ((el: Element) => boolean) | undefined,
  cache: SharedStopCache,
): boolean {
  // Per widget AND item role: a menu can mix menuitem and menuitemradio.
  const role = item.getAttribute('role') ?? '';
  let byRole = cache.get(widget);
  if (!byRole) cache.set(widget, (byRole = new Map()));
  let result = byRole.get(role);
  if (result === undefined) byRole.set(role, (result = findsRepeatedSiblingStop(widget, item, isVisible)));
  return result;
}

/** Per-scan answers of {@link sharesRovingStop}: widget → item role → shares a stop. */
type SharedStopCache = Map<Element, Map<string, boolean>>;

function findsRepeatedSiblingStop(
  widget: Element,
  item: Element,
  isVisible?: (el: Element) => boolean,
): boolean {
  const ng = ngDebug();
  const widgetRole = widget.getAttribute('role');
  const itemRole = item.getAttribute('role');
  if (!ng || !widgetRole || !itemRole) return false;
  let host: Element | null = null;
  for (let el = widget.parentElement; el; el = el.parentElement) {
    if (isComponentHost(el, ng)) {
      host = el;
      break;
    }
  }
  if (!host) return false;
  for (const other of host.querySelectorAll(`[role="${widgetRole}"] [role="${itemRole}"]`)) {
    const otherWidget = other.parentElement?.closest(COMPOSITE_SELECTOR);
    if (!otherWidget || otherWidget === widget || otherWidget.getAttribute('role') !== widgetRole) continue;
    if (!isTabbable(other, isVisible)) continue;
    if (repeatedSiblings(widget, otherWidget, host)) return true;
  }
  return false;
}

/**
 * True when `a` and `b` sit in sibling branches of the same kind: below their
 * lowest common ancestor (inside `bound`), the branch holding each is the same
 * tag with the same (non-empty) set of classes, once Angular's `ng-*` classes
 * (e.g. `ng-star-inserted` from the animations module) and BEM modifiers are
 * set aside. Unclassed wrappers never match: the safe direction.
 */
function repeatedSiblings(a: Element, b: Element, bound: Element): boolean {
  if (a.contains(b) || b.contains(a)) return false;
  for (let branchA: Element | null = a; branchA && branchA !== bound; branchA = branchA.parentElement) {
    const parent = branchA.parentElement;
    if (!parent || !parent.contains(b)) continue;
    let branchB: Element | null = b;
    while (branchB && branchB.parentElement !== parent) branchB = branchB.parentElement;
    if (!branchB || branchB === branchA || branchB.tagName !== branchA.tagName) return false;
    const setA = structuralClasses(branchA);
    const setB = structuralClasses(branchB);
    return setA.length > 0 && setA.length === setB.length && setA.every((c) => setB.includes(c));
  }
  return false;
}

/** Classes that say what an element is, not its state: no `ng-*`, no BEM `--modifier`. */
function structuralClasses(el: Element): string[] {
  return [...el.classList].filter((c) => !c.startsWith('ng-') && !c.includes('--')).sort();
}

function isComponentHost(el: Element, ng: ReturnType<typeof ngDebug>): boolean {
  try {
    return ng?.getComponent(el) != null;
  } catch {
    return false;
  }
}

/**
 * True when an ancestor of `element` is tabbable (focus lands there, as with an
 * icon inside a link) or is in `flagged` (already reported).
 */
function hasTabbableOrFlaggedAncestor(
  element: Element,
  flagged: ReadonlySet<Element>,
  isVisible?: (el: Element) => boolean,
): boolean {
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (flagged.has(el) || isTabbable(el, isVisible)) return true;
  }
  return false;
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
function partOfKeyboardOperatedWidget(
  element: Element,
  isVisible?: (el: Element) => boolean,
  keyCache?: Map<Element, boolean>,
  sharedCache?: SharedStopCache,
): boolean {
  const item = element.parentElement?.closest(ITEM_SELECTOR);
  if (item?.parentElement?.closest(COMPOSITE_SELECTOR)) {
    // 'no-keys' too: the item itself is reported, so its parts needn't be.
    if (isTabbable(item, isVisible) || reachedWithinWidget(item, isVisible, keyCache, sharedCache)) return true;
  }
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (!isTabbable(el, isVisible)) continue;
    return hasKeyEvent(resolveListenerEvents(el));
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

/**
 * A selector that matches only `element`, for the overlay to draw the finding
 * on. {@link shortSelector} can match many elements (an icon repeated in every
 * table row), and the overlay would draw them all on the first. Builds an
 * `:nth-child` path upward and stops as soon as it is unique, like axe's own
 * targets. Undefined when the short selector is already unique, when `CSS.escape`
 * is missing, or for an element in a shadow root.
 */
export function uniqueLocator(element: Element): string | undefined {
  const doc = element.ownerDocument;
  const escape = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  if (!doc || typeof escape !== 'function' || element.getRootNode() !== doc) return undefined;
  const count = (selector: string) => {
    try {
      return doc.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  };
  const short = shortSelector(element);
  if (count(short) === 1 && doc.querySelector(short) === element) return undefined;
  const step = (el: Element) => {
    if (el.id && count(`#${escape(el.id)}`) === 1) return { text: `#${escape(el.id)}`, anchored: true };
    const classes = [...el.classList].slice(0, 2).map((c) => `.${escape(c)}`).join('');
    const index = el.parentElement ? [...el.parentElement.children].indexOf(el) + 1 : 1;
    return { text: `${el.tagName.toLowerCase()}${classes}:nth-child(${index})`, anchored: false };
  };
  const steps: string[] = [];
  for (let el: Element | null = element; el && el !== doc.documentElement; el = el.parentElement) {
    const { text, anchored } = step(el);
    steps.unshift(text);
    const selector = steps.join(' > ');
    if (anchored || count(selector) === 1) return selector;
  }
  return undefined;
}

/** Truncated outerHTML for a finding's `html`. */
export function shortHtml(element: Element): string {
  const html = element.outerHTML ?? '';
  return html.length > 160 ? `${html.slice(0, 159)}…` : html;
}

/**
 * Scan `root` for keyboard-operability problems and return them as findings.
 * Runs entirely in the page. Listener-based checks and attribution need the
 * live `window.ng`, so in production only the markup-based checks (roles, tooltip
 * markers, icon titles, tab order) report anything.
 */
export function scanKeyboard(
  root: ParentNode = document,
  options: KeyboardScanOptions = {},
): A11yFinding[] {
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  const isVisible = options.isVisible;
  const findings: A11yFinding[] = [];
  const keyCache = new Map<Element, boolean>();
  const sharedCache: SharedStopCache = new Map();
  /** Elements reported as unreachable controls, so the hover check doesn't repeat them. */
  const unreachable = new Set<Element>();
  /** Angular listener names per element, read once and shared by both passes. */
  const listenerEvents = new Map<Element, string[]>();
  const eventsOf = (el: Element): string[] => {
    let events = listenerEvents.get(el);
    if (!events) listenerEvents.set(el, (events = resolveListenerEvents(el)));
    return events;
  };

  const hoverFinding = (element: Element, signal: HoverSignal): A11yFinding => {
    const url = `${RULE_DOCS}/hover-only-content`;
    // The disabled control itself, or a wrapper around one (Angular Material's
    // documented way to give a disabled button a tooltip): a tooltip on any
    // wrapper, or other hover content on a wrapper whose only child is the control.
    const only = element.children.length === 1 ? element.children[0] : null;
    const disabled =
      isNativelyFocusable(element) && isDisabled(element)
        ? element
        : signal === 'tooltip'
          ? [...element.querySelectorAll('button, input, select, textarea')].find(isDisabled)
          : only && isNativelyFocusable(only) && isDisabled(only)
            ? only
            : undefined;
    if (disabled) {
      return make(
        element,
        'ngbr/hover-only-content',
        signal === 'tooltip' ? 'moderate' : 'minor',
        `Keyboard users may not see this disabled control's hover content: a disabled ` +
          `control can't take focus, so its tooltip only opens for the mouse. Use ` +
          `aria-disabled="true" instead of disabled, or show the reason as text. ` +
          `Heuristic — verify manually.`,
        url,
      );
    }
    if (signal === 'title') {
      return make(
        element,
        'ngbr/hover-only-content',
        'minor',
        `Only mouse users see this icon's title: Tab doesn't reach the icon, so keyboard ` +
          `users can't show its title. Show the text on the page, or put the icon in a ` +
          `focusable control with a visible label or tooltip. Heuristic — verify manually.`,
        url,
      );
    }
    if (signal === 'hover-listener') {
      return make(
        element,
        'ngbr/hover-only-content',
        'minor',
        `Keyboard users may not see what this shows on hover: it listens for the mouse ` +
          `moving over it, but Tab doesn't reach it. If it shows content, make it focusable ` +
          `and show the content on focus too, or show it on the page. Heuristic — verify manually.`,
        url,
      );
    }
    return make(
      element,
      'ngbr/hover-only-content',
      'moderate',
      `Keyboard users may not see this tooltip: it opens on hover, but Tab doesn't reach ` +
        `it. Make it focusable (a <button>, or tabindex="0") and check the tooltip opens on ` +
        `focus, or show the text on the page. Heuristic — verify manually.`,
      url,
    );
  };

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
      locator: uniqueLocator(element),
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
    const events = eventsOf(element);
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

    const focusable = isTabbable(element, isVisible);

    if (!focusable) {
      // A click-only part of something the keyboard operates is a mouse shortcut.
      // Only for unreachable elements: one Tab reaches is still checked below.
      if (!interactiveByRole && partOfKeyboardOperatedWidget(element, isVisible, keyCache, sharedCache)) continue;
      const within = interactiveByRole ? reachedWithinWidget(element, isVisible, keyCache, sharedCache) : false;
      if (within === 'reached') continue;
      if (within === 'no-keys') {
        findings.push(
          make(
            element,
            'ngbr/unreachable-control',
            'moderate',
            `Keyboard users may not be able to reach this item: it has role="${role}" and is ` +
              `out of the tab order, like a roving-tabindex item, but nothing in or around its ` +
              `widget handles keys, so arrow keys may not move to it. Handle the arrow keys, or ` +
              `use aria-activedescendant. Heuristic — verify manually.`,
            `${RULE_DOCS}/unreachable-control`,
          ),
        );
        unreachable.add(element);
        continue;
      }
      const reason = interactiveByRole ? `has role="${role}"` : 'has a click handler';
      unreachable.add(element);
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
    const hasKey = hasKeyEvent(events);
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

  // Hover-only content: a tooltip, hover listener or icon `title` on something
  // Tab can't reach, so keyboard users may never see what it shows.
  // Seeded with the unreachable controls, so an icon inside one isn't reported again.
  const hoverFlagged = new Set<Element>(unreachable);
  for (const element of root.querySelectorAll('*')) {
    if (modal && !modal.contains(element)) continue;
    if (hoverFlagged.has(element) || element.closest(OVERLAY_EXCLUDE_SELECTOR)) continue;
    const signal = hoverSignal(element, eventsOf(element));
    if (!signal) continue;
    if (isTabbable(element, isVisible) || isHidden(element, isVisible)) continue;
    // A wrapper around something Tab reaches: focus lands inside it. Skipped to
    // keep false positives down, though the tooltip may still not open on focus.
    if (hasTabbableDescendant(element, isVisible)) continue;
    // Inside something Tab reaches (an icon in a link), or inside an element
    // already reported: one finding is enough.
    if (hasTabbableOrFlaggedAncestor(element, hoverFlagged, isVisible)) continue;
    if (reachedWithinWidget(element, isVisible, keyCache, sharedCache) === 'reached') continue;
    hoverFlagged.add(element);
    findings.push(hoverFinding(element, signal));
  }

  // Drag and drop with no keyboard way to move the items: no Move up / Move down
  // style control near the list, and no drag handle Tab reaches that handles keys.
  // One finding per list, on the list.
  const groups = dragGroups(root, (el) => isHidden(el, isVisible));
  const startsOf = (container: Element, items: Element[]) => [
    ...new Set([container, ...items.flatMap(dragHandles)]),
  ];
  // A roving-tabindex board has one tab stop among all its lists; without any tab
  // stop on the page's drag lists, a tabindex="-1" item is out of reach.
  const anyTabStop = groups.some(({ container, items }) =>
    startsOf(container, items).some((el) => isTabbable(el, isVisible)),
  );
  for (const { container, items, cdk } of groups) {
    if (modal && !modal.contains(container)) continue;
    if (container.closest(OVERLAY_EXCLUDE_SELECTOR)) continue;
    if (hasMoveControl(container, (el) => isTabbable(el, isVisible))) continue;
    const starts = startsOf(container, items);
    // Reachable: a tab stop, or an element script can focus (any tabindex) when a
    // drag list on the page has a tab stop, as in a roving-tabindex board where
    // one card is the tab stop and arrow keys move to the rest. The key-listener
    // check below then decides.
    const reachable = starts.filter(
      (el) =>
        isTabbable(el, isVisible) ||
        (anyTabStop && hasTabindex(el) && !isDisabled(el) && !isHidden(el, isVisible)),
    );
    const url = `${RULE_DOCS}/drag-without-keyboard`;
    const count = items.length === 1 ? '1 item here moves' : `${items.length} items here move`;
    const fix =
      `Add buttons that move an item (Move up, Move down), or make each drag handle a ` +
      `button that moves its item with the arrow keys and announces the new position. ` +
      `Buttons also help people who can't drag with a mouse.`;
    if (reachable.length === 0) {
      findings.push(
        make(
          container,
          'ngbr/drag-without-keyboard',
          // Native draggable="true" is weaker evidence of a list to reorder than CDK's.
          cdk ? 'serious' : 'moderate',
          `Keyboard users can't move these items: ${count} by drag and drop, but Tab ` +
            `doesn't reach a drag handle and there's no other control to move them. ` +
            `${fix} Heuristic — verify manually.`,
          url,
        ),
      );
      continue;
    }
    // The keyboard can reach a handle or item. In a production build the key
    // listeners can't be seen, so assume it handles keys.
    if (!listenersVisible()) continue;
    // From each reachable handle up through the list, to and including the
    // nearest component host above it: a sortable tab list, say, handles keys on
    // a wrapper.
    const ng = ngDebug();
    const keyed = (start: Element): boolean => {
      for (let el: Element | null = start; el && el !== el.ownerDocument?.body; el = el.parentElement) {
        if (hasKeyEvent(eventsOf(el))) return true;
        if (!container.contains(el) && isComponentHost(el, ng)) break;
      }
      return false;
    };
    const handlesKeys = reachable.some(keyed);
    if (handlesKeys) continue;
    findings.push(
      make(
        container,
        'ngbr/drag-without-keyboard',
        'moderate',
        `Keyboard users may not be able to move these items: ${count} by drag and drop, ` +
          `and the keyboard can reach their drag handles, but nothing on them handles keys. ` +
          `${fix} Heuristic — verify manually.`,
        url,
      ),
    );
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
