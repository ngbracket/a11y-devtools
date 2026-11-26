import { appComponentFromPath, DEFAULT_FRAMEWORK_PREFIXES, resolveComponentPath, resolveDirectiveNames } from '../attribution.js';
import { ngbrRuleCriteria } from '../report/wcag.js';
import type { A11yFinding } from '../scan.js';
import { RULE_DOCS, shortHtml, shortSelector, uniqueLocator } from './keyboard-scan.js';

export const FOCUS_INDICATOR_RULE = 'ngbr/focus-indicator-contrast';

/** Pixels around the element that count as part of its focus indicator: an outline with an offset, a glow. */
export const FOCUS_MARGIN = 8;

/** A rectangle in viewport CSS pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How focusing an element changed the pixels around it. */
export interface FocusChange {
  /** Pixels that differ between the unfocused and focused screenshots. */
  changed: number;
  /** Changed pixels whose colour changed by a contrast ratio of 3:1 or more. */
  strong: number;
  /** The largest contrast ratio between a pixel's unfocused and focused colour; 1 when nothing changed. */
  maxRatio: number;
}

/** A channel difference at or below this is rendering noise, not a change. */
const NOISE = 2;

function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Compare two RGBA pixel buffers of the same area (unfocused, then focused),
 * pixel by pixel. The 3:1 is the contrast between the same pixel's two colours,
 * as WCAG's focus-appearance guidance measures a focus indicator.
 */
export function focusChange(before: ArrayLike<number>, after: ArrayLike<number>): FocusChange {
  let changed = 0;
  let strong = 0;
  let maxRatio = 1;
  for (let i = 0; i + 3 < before.length && i + 3 < after.length; i += 4) {
    const dr = Math.abs(before[i] - after[i]);
    const dg = Math.abs(before[i + 1] - after[i + 1]);
    const db = Math.abs(before[i + 2] - after[i + 2]);
    if (Math.max(dr, dg, db) <= NOISE) continue;
    changed++;
    const a = luminance(before[i], before[i + 1], before[i + 2]);
    const b = luminance(after[i], after[i + 1], after[i + 2]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio >= 3) strong++;
    if (ratio > maxRatio) maxRatio = ratio;
  }
  return { changed, strong, maxRatio };
}

/**
 * The fewest 3:1 pixels that count as a visible indicator: one pixel along two
 * sides of the element, so a 1px outline or a 2px underline passes, and a
 * slight background tint or a colour shift in the text doesn't.
 */
export function minimumArea(box: Box): number {
  return Math.round(box.width + box.height);
}

/** The area screenshots are compared over: the element plus {@link FOCUS_MARGIN}, inside the viewport. */
export function compareArea(box: Box, viewport: { width: number; height: number }): Box | null {
  const x = Math.max(0, Math.floor(box.x - FOCUS_MARGIN));
  const y = Math.max(0, Math.floor(box.y - FOCUS_MARGIN));
  const right = Math.min(viewport.width, Math.ceil(box.x + box.width + FOCUS_MARGIN));
  const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + FOCUS_MARGIN));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

function deepActiveElement(doc: Document): Element | null {
  let active: Element | null = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The focused element as the driver sees it between screenshots. */
export interface FocusedStop {
  id: number;
  /** The element's box in the viewport. */
  box: Box;
  /** The area to compare, or null when the element is off screen. */
  area: Box | null;
  /** Set when the stop can't be measured: an iframe, or an element with no size. */
  skip?: string;
}

export interface FocusIndicatorProbe {
  /** The focused element, or null when focus is on the page itself. */
  current(): FocusedStop | null;
  /** Take focus off the element, for the unfocused screenshot. */
  blur(): void;
  /** Put focus back, so the next Tab moves on from it. */
  refocus(id: number): void;
  /** A finding for this stop, or null when its indicator is visible enough. */
  finding(id: number, change: FocusChange): A11yFinding | null;
}

/**
 * The in-page half of the focus-indicator check. The driver presses real Tab
 * keys; after each one it asks for the focused element, screenshots the page,
 * blurs the element, screenshots again, compares the two around the element
 * (see {@link focusChange}), then refocuses it and asks for a finding.
 */
export function createFocusIndicatorProbe(
  doc: Document = document,
  frameworkPrefixes: readonly string[] = DEFAULT_FRAMEWORK_PREFIXES,
): FocusIndicatorProbe {
  const ids = new WeakMap<Element, number>();
  const byId = new Map<number, Element>();
  const boxes = new Map<number, Box>();
  const view = doc.defaultView;

  return {
    current() {
      const active = deepActiveElement(doc);
      if (!active || active === doc.body || active === doc.documentElement) return null;
      let id = ids.get(active);
      if (id === undefined) {
        id = byId.size + 1;
        ids.set(active, id);
        byId.set(id, active);
      }
      const r = active.getBoundingClientRect();
      const box = { x: r.x, y: r.y, width: r.width, height: r.height };
      boxes.set(id, box);
      const viewport = { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 };
      if (active.tagName === 'IFRAME') return { id, box, area: null, skip: 'iframe' };
      if (box.width < 1 || box.height < 1) return { id, box, area: null, skip: 'no size' };
      return { id, box, area: compareArea(box, viewport) };
    },

    blur() {
      (deepActiveElement(doc) as HTMLElement | null)?.blur?.();
    },

    refocus(id) {
      (byId.get(id) as HTMLElement | undefined)?.focus?.({ preventScroll: true });
    },

    finding(id, change) {
      const element = byId.get(id);
      const box = boxes.get(id);
      if (!element || !box) return null;
      const needed = minimumArea(box);
      if (change.changed > 0 && change.strong >= needed) return null;
      const ratio = `${(Math.floor(change.maxRatio * 100) / 100).toFixed(2)}:1`;
      const help =
        change.changed === 0
          ? `Focusing this element doesn't visibly change it, so keyboard users can't see where focus is. ` +
            `Add a focus style, such as an outline, with at least 3:1 contrast against its surroundings. ` +
            `Found by comparing screenshots. Heuristic — verify manually.`
          : `Focusing this element changes ${change.changed} pixels, but the strongest change is ${ratio}, ` +
            `and only ${change.strong} pixels change by 3:1 or more (at least ${needed} expected for an ` +
            `element this size). The focus indicator is hard to see. Make it at least 3:1 against the ` +
            `unfocused state, for example with a solid outline. Found by comparing screenshots. ` +
            `Heuristic — verify manually.`;
      const componentPath = resolveComponentPath(element);
      return {
        id: FOCUS_INDICATOR_RULE,
        impact: change.changed === 0 ? 'serious' : 'moderate',
        help,
        helpUrl: `${RULE_DOCS}/focus-indicator-contrast`,
        wcag: ngbrRuleCriteria(FOCUS_INDICATOR_RULE),
        component: appComponentFromPath(componentPath, frameworkPrefixes),
        componentPath,
        directives: resolveDirectiveNames(element),
        target: shortSelector(element),
        locator: uniqueLocator(element),
        html: shortHtml(element),
      };
    },
  };
}
