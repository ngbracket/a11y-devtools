/**
 * The keyboard layer, part A: compute the order in which Tab moves through a
 * page. This is the ~2/3 of accessibility axe can't test — keyboard operability
 * — and, like the axe findings, every stop is attributed to the component that
 * rendered it.
 *
 * The tabbable set and ordering mirror the browser's own algorithm (and the
 * well-known `tabbable` element definition), implemented here with no runtime
 * dependency: elements with a positive `tabindex` come first in ascending order
 * (the anti-pattern that hijacks focus order), then everything with `tabindex=0`
 * or a native default in DOM order.
 */
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
} from '../attribution.js';
import { OVERLAY_EXCLUDE_SELECTOR } from '../overlay.js';

/** One element in the resolved tab sequence, with its owning component. */
export interface TabStop {
  element: Element;
  /** 1-based position in the resolved tab order. */
  order: number;
  /** Resolved tabindex: 0 for a native default or explicit `tabindex="0"`, else the positive value. */
  tabindex: number;
  /** True when an explicit positive `tabindex` puts this stop out of DOM order. */
  positive: boolean;
  /** Nearest app-owned component (walks past UI primitives); null in prod. */
  component: string | null;
  /** Owning components from the node up to the root, nearest first; [] in prod. */
  componentPath: string[];
}

export interface TabSequenceOptions {
  /** UI-primitive prefixes to walk past during attribution; see the scan options. */
  frameworkPrefixes?: readonly string[];
  /**
   * Visibility predicate override — mainly for tests, where jsdom reports no
   * layout. Defaults to a computed-style + `inert`/`hidden`/`<details>` check.
   */
  isVisible?: (element: Element) => boolean;
}

/** Elements that can hold focus and thus may appear in the tab order. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'audio[controls]',
  'video[controls]',
  'summary',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]',
].join(',');

/**
 * True when `element` contains something focusable (a link, control, or
 * `tabindex` element). A click listener on such a container is almost always
 * event delegation — handling clicks on the controls inside — not a fake button.
 */
export function hasFocusableDescendant(element: Element): boolean {
  return element.querySelector(FOCUSABLE_SELECTOR) !== null;
}

/** A native default of 0 (focusable without a tabindex attribute), else -1. */
function nativeTabIndex(element: Element): number {
  return isNativelyFocusable(element) ? 0 : -1;
}

/**
 * True when the element takes focus without an explicit `tabindex` — a link with
 * an href, a form control, a `<summary>`, an editing host, and the embedded
 * document elements. Disabled/hidden state is handled separately.
 */
export function isNativelyFocusable(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'a':
    case 'area':
      return element.hasAttribute('href');
    case 'button':
    case 'select':
    case 'textarea':
      return true;
    case 'input':
      return element.getAttribute('type')?.toLowerCase() !== 'hidden';
    case 'summary':
      return true;
    case 'iframe':
    case 'object':
    case 'embed':
      return true;
    case 'audio':
    case 'video':
      return element.hasAttribute('controls');
  }
  const editable = element.getAttribute('contenteditable');
  return editable !== null && editable !== 'false';
}

/**
 * The tabindex the browser will use: the parsed attribute when present and
 * numeric, otherwise the native default. A non-numeric `tabindex` (e.g.
 * `tabindex="foo"`) is ignored by browsers, so it falls back to the native value.
 */
export function resolvedTabIndex(element: Element): number {
  const attr = element.getAttribute('tabindex');
  if (attr === null) return nativeTabIndex(element);
  const parsed = Number.parseInt(attr, 10);
  return Number.isNaN(parsed) ? nativeTabIndex(element) : parsed;
}

/** True when `element` (or an ancestor) is disabled via a control or `<fieldset disabled>`. */
function isDisabled(element: Element): boolean {
  if ('disabled' in element && (element as { disabled?: boolean }).disabled) return true;
  // A disabled fieldset disables its controls (except those inside its first legend).
  return element.closest('fieldset[disabled]') !== null && element.closest('legend') === null;
}

/**
 * Structurally hidden — removed from the tab order by markup, independent of any
 * layout: inside an `[inert]` or `[hidden]` subtree, or non-summary content of a
 * closed `<details>`. Kept separate from the layout check so the injectable
 * visibility predicate only ever overrides computed-style visibility.
 */
function isStructurallyHidden(element: Element): boolean {
  if (element.closest('[inert]') || element.closest('[hidden]')) return true;
  const closedDetails = element.closest('details:not([open])');
  return closedDetails !== null && element.closest('summary') === null && element !== closedDetails;
}

/** Layout-aware default visibility: computed `display`/`visibility` up the tree. */
function defaultIsVisible(element: Element): boolean {
  const view = element.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return true; // no layout engine (e.g. jsdom) — assume visible
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

/**
 * True when `element` participates in sequential keyboard navigation: it's
 * focusable, has a resolved `tabindex >= 0`, and is neither disabled nor hidden.
 * `isVisible` overrides only the layout (computed-style) part of the check.
 */
export function isTabbable(element: Element, isVisible: (el: Element) => boolean = defaultIsVisible): boolean {
  if (resolvedTabIndex(element) < 0) return false;
  if (isDisabled(element)) return false;
  if (isStructurallyHidden(element)) return false;
  // An element matched only by `[contenteditable]` with the value "false" isn't focusable.
  const editable = element.getAttribute('contenteditable');
  if (editable === 'false' && !isNativelyFocusable(element) && !element.hasAttribute('tabindex')) {
    return false;
  }
  return isVisible(element);
}

/**
 * The resolved tab order within `root`: positive-tabindex stops first (ascending,
 * ties in DOM order), then `tabindex=0`/native stops in DOM order — the order a
 * browser actually moves focus. Each stop carries its owning component.
 */
export function tabSequence(
  root: ParentNode = document,
  options: TabSequenceOptions = {},
): TabStop[] {
  const isVisible = options.isVisible ?? defaultIsVisible;
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;

  // The devtools' own UI (the on/off pill) is a real tab stop, but it isn't the
  // app's: leave it out of the order, the tab-order layer and the modal check.
  const candidates = [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (el) => !el.closest(OVERLAY_EXCLUDE_SELECTOR) && isTabbable(el, isVisible),
  );

  const withMeta = candidates.map((element, domIndex) => ({
    element,
    domIndex,
    tabindex: resolvedTabIndex(element),
    positive: /^\d+$/.test(element.getAttribute('tabindex') ?? '') && resolvedTabIndex(element) > 0,
  }));

  const positives = withMeta
    .filter((m) => m.tabindex > 0)
    .sort((a, b) => a.tabindex - b.tabindex || a.domIndex - b.domIndex);
  const zeros = withMeta.filter((m) => m.tabindex === 0); // already in DOM order

  return [...positives, ...zeros].map((m, i) => {
    const componentPath = resolveComponentPath(m.element);
    return {
      element: m.element,
      order: i + 1,
      tabindex: m.tabindex,
      positive: m.positive,
      component: appComponentFromPath(componentPath, prefixes),
      componentPath,
    };
  });
}

/** Where a stop starts and ends on screen, for {@link visualOrderJumps}. */
export interface StopRect {
  /** Top-left of where the element starts (its first line box, for wrapped inline text). */
  top: number;
  left: number;
  /** Right edge of the whole element. */
  right?: number;
  /** Top-left of where it ends (its last line box); defaults to `top`/`left`. */
  endTop?: number;
  endLeft?: number;
}

/**
 * The default {@link StopRect}: an inline link that wraps across lines starts on
 * one line and ends on the next, and its bounding box starts at the left edge —
 * so compare line boxes, not the bounding box.
 */
function stopRect(el: Element): StopRect {
  const box = el.getBoundingClientRect();
  const lines = el.getClientRects();
  if (lines.length === 0) return { top: box.top, left: box.left, right: box.right };
  const first = lines[0];
  const last = lines[lines.length - 1];
  return { top: first.top, left: first.left, right: box.right, endTop: last.top, endLeft: last.left };
}

/**
 * Indices (0-based, into the sequence) where the tab path jumps *backward against
 * reading order* — a stop that sits clearly above the stop before it (without
 * moving right), or well to the left on the same row. A heuristic signal that
 * DOM/tabindex order has drifted from the visual order a sighted keyboard user
 * expects; always "verify manually". `getRect` is injectable for tests.
 *
 * Moving up into the *next column* — starting right of where the previous stop
 * ends, like a sidebar then the main content, or across a multi-column footer —
 * is normal reading order, so it isn't a jump. (A stop that moves up but still
 * overlaps the previous one horizontally is.)
 */
export function visualOrderJumps(
  stops: readonly TabStop[],
  getRect: (el: Element) => StopRect = stopRect,
  rowThreshold = 8,
): number[] {
  const jumps: number[] = [];
  for (let i = 1; i < stops.length; i++) {
    const prev = getRect(stops[i - 1].element);
    const curr = getRect(stops[i].element);
    // Compare where the previous stop *ends* with where this one *starts*.
    const prevTop = prev.endTop ?? prev.top;
    const prevLeft = prev.endLeft ?? prev.left;
    const movedUp = curr.top < prevTop - rowThreshold;
    const nextColumn = curr.left >= (prev.right ?? prev.left + rowThreshold);
    const sameRowMovedLeft =
      Math.abs(curr.top - prevTop) <= rowThreshold && curr.left < prevLeft - rowThreshold;
    if ((movedUp && !nextColumn) || sameRowMovedLeft) jumps.push(i);
  }
  return jumps;
}
