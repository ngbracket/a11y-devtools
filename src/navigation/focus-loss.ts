/**
 * Focus lost between two moments: a route change or a re-render that leaves
 * keyboard focus on `<body>`.
 *
 * A scan sees the page at one moment, so it can't see this. When the focused
 * control is removed (the link that was clicked goes away with the old view,
 * or an `@if` / `@for` re-renders it), the browser drops focus to `<body>` and
 * the next Tab starts from the top of the page. This probe watches for that and
 * reports it as an `ngbr/*` finding, attributed to the component the control
 * belonged to. It also keeps a record of each route change: where focus went,
 * whether the title changed, and what live regions announced.
 *
 * It knows nothing about the Angular Router: a route change is a change of
 * `location.pathname + location.search`, checked when the host says the app has
 * settled ({@link FocusLossProbe.notifyStable}).
 */
import {
  appComponentFromPath,
  DEFAULT_FRAMEWORK_PREFIXES,
  resolveComponentPath,
  resolveDirectiveNames,
} from '../attribution.js';
import { OVERLAY_ATTR } from '../overlay.js';
import { deepActiveElement } from '../keyboard/focus-walk.js';
import { RULE_DOCS, shortHtml, shortSelector, uniqueLocator } from '../keyboard/keyboard-scan.js';
import { ngbrRuleCriteria } from '../report/wcag.js';
import type { A11yFinding } from '../scan.js';

/** Where focus ended up after a route change. */
export type NavigationFocus = 'body' | 'target' | 'other';

/** One route change, as the probe saw it. */
export interface NavigationRecord {
  /** Route before (`pathname + search`). */
  from: string;
  /** Route after. */
  to: string;
  /**
   * How the change was made, when the driver knows: `link` (a link was
   * activated from the keyboard) or `history` (`history.pushState` and a
   * `popstate` event). Unset in the app.
   */
  via?: 'link' | 'history';
  /** `body`: focus was lost; `target`: inside the expected focus target; `other`: anywhere else. */
  focus: NavigationFocus;
  /** Short selector of the focused element after the change; null when focus is on `<body>`. */
  focusedTarget: string | null;
  /** Component that owns the focused element after the change. */
  focusedComponent: string | null;
  /** Short selector of the element that had focus before the change, if any. */
  focusBefore: string | null;
  titleBefore: string;
  titleAfter: string;
  titleChanged: boolean;
  /** Text live regions announced after the change, in order. */
  announcements: string[];
}

export interface FocusLossProbeOptions {
  /** Component-name prefixes to walk past during attribution. */
  frameworkPrefixes?: readonly string[];
  /**
   * How long to wait after a removal or a route change before checking focus,
   * so a dialog or menu that restores focus on close has done so. Default 150ms.
   */
  graceMs?: number;
  /**
   * Where focus is expected to go after a route change. Only used to label the
   * record (`target` / `other`); focus left on `<body>` is the only finding.
   * Default `'main, [role="main"], h1'`.
   */
  focusTarget?: string;
  /** Called with each finding as it happens. */
  onFinding?: (finding: A11yFinding, route: string) => void;
  /** Called with each route change record. */
  onNavigation?: (record: NavigationRecord) => void;
  /** Current route. Defaults to `location.pathname + location.search`. */
  route?: () => string;
}

export interface FocusLossProbe {
  /** The host says the app has settled: check for a route change. */
  notifyStable(): void;
  /** Wait until no check is pending (tests and the headless driver). */
  settled(): Promise<void>;
  /** Route changes recorded so far, oldest first. */
  records(): NavigationRecord[];
  /** Findings reported so far, oldest first. */
  findings(): A11yFinding[];
  stop(): void;
}

export const DEFAULT_FOCUS_TARGET = 'main, [role="main"], h1';

/** Live regions, and the hidden element Angular CDK's LiveAnnouncer writes into. */
const LIVE_REGION = [
  '[aria-live]:not([aria-live="off"])',
  '[role="status"]',
  '[role="alert"]',
  '[role="log"]',
  '.cdk-live-announcer-element',
].join(', ');

/** What the probe knows about the focused element, read while it's still in the page. */
interface FocusSnapshot {
  element: Element;
  /** Ancestors, nearest first, for finding a box to draw once the element is gone. */
  ancestors: Element[];
  route: string;
  component: string | null;
  componentPath: string[];
  directives: string[];
  target: string;
  html: string;
}

function safeClosest(el: Element, selector: string): Element | null {
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/** Start watching `doc` for focus lost to a removal or a route change. */
export function createFocusLossProbe(
  doc: Document = document,
  options: FocusLossProbeOptions = {},
): FocusLossProbe {
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  const graceMs = options.graceMs ?? 150;
  const focusTarget = options.focusTarget ?? DEFAULT_FOCUS_TARGET;
  // Hash routing (`#/orders`) counts; an in-page anchor (`#section`) doesn't.
  const route =
    options.route ??
    (() => location.pathname + location.search + (location.hash.startsWith('#/') ? location.hash : ''));

  const records: NavigationRecord[] = [];
  const findings: A11yFinding[] = [];
  /** Checks waiting out the grace period: each timer and the resolver of its promise. */
  const pending = new Map<Promise<void>, { timer: ReturnType<typeof setTimeout>; done: () => void }>();

  let focused: FocusSnapshot | undefined;
  /** The element focused on each route, while it has focus, for "where was focus before the change". */
  const focusByRoute = new Map<string, FocusSnapshot>();
  let lastRoute = route();
  let lastTitle = doc.title;
  let navigating = false;
  /** Live region text since the last route change was recorded. */
  const announced: string[] = [];

  const ours = (el: Element): boolean => el.closest(`[${OVERLAY_ATTR}]`) !== null;
  const onBody = (el: Element | null): boolean =>
    !el || el === doc.body || el === doc.documentElement;

  function snapshot(element: Element): FocusSnapshot {
    const componentPath = resolveComponentPath(element);
    const ancestors: Element[] = [];
    for (let el = element.parentElement; el && el !== doc.body; el = el.parentElement) ancestors.push(el);
    return {
      element,
      ancestors,
      route: route(),
      component: appComponentFromPath(componentPath, prefixes),
      componentPath,
      directives: resolveDirectiveNames(element),
      target: shortSelector(element),
      html: shortHtml(element),
    };
  }

  /** Run `fn` after the grace period, tracked so `settled()` can wait for it. */
  function later(fn: () => void): void {
    let done!: () => void;
    const promise = new Promise<void>((resolve) => (done = resolve));
    const timer = setTimeout(() => {
      try {
        fn();
      } finally {
        pending.delete(promise);
        done();
      }
    }, graceMs);
    pending.set(promise, { timer, done });
  }

  function report(snap: FocusSnapshot, id: string, help: string, page: string, box: boolean): void {
    // Draw the box on the nearest ancestor still in the page: the element is gone.
    // Not after a route change: the whole view went, so that box would be most of the page.
    const anchor = box ? snap.ancestors.find((el) => el.isConnected) : undefined;
    const finding: A11yFinding = {
      id,
      impact: 'moderate',
      help,
      helpUrl: `${RULE_DOCS}/${id.slice('ngbr/'.length)}`,
      wcag: ngbrRuleCriteria(id),
      component: snap.component,
      componentPath: snap.componentPath,
      directives: snap.directives,
      target: snap.target,
      locator: anchor ? (uniqueLocator(anchor) ?? shortSelector(anchor)) : undefined,
      html: snap.html,
    };
    findings.push(finding);
    options.onFinding?.(finding, page);
  }

  const onFocusIn = (event: FocusEvent): void => {
    // The element itself, not its shadow host.
    const el = event.composedPath()[0] ?? event.target;
    if (!(el instanceof Element) || onBody(el) || ours(el)) return;
    focused = snapshot(el);
    focusByRoute.set(focused.route, focused);
  };

  // Focus moved to the page body while the element stays (a click on the
  // background): it no longer has focus, so removing it later loses nothing.
  // Checked a moment later, because a browser may blur an element as it's removed.
  const onFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget) return; // focus moved to another element: focusin handles it
    const snap = focused;
    if (!snap) return;
    queueMicrotask(() => {
      if (focused !== snap || !snap.element.isConnected || !onBody(deepActiveElement(doc))) return;
      focused = undefined;
      if (focusByRoute.get(snap.route) === snap) focusByRoute.delete(snap.route);
    });
  };

  function checkRemoval(): void {
    const snap = focused;
    if (!snap || snap.element.isConnected) return;
    focused = undefined;
    later(() => {
      // A route change took the element away: the navigation check reports that.
      if (route() !== snap.route || navigating) return;
      if (!onBody(deepActiveElement(doc))) return; // focus was put somewhere: fine
      report(
        snap,
        'ngbr/focus-lost-on-rerender',
        `Focus was lost when this element was removed: it had focus, a re-render ` +
          `took it out of the page, and focus fell back to the page body, so the next ` +
          `Tab starts from the top. Move focus to a sensible place before removing it ` +
          `(the next item, the list, or a heading). Heuristic — verify manually.`,
        snap.route,
        true,
      );
    });
  }

  function logAnnouncements(mutations: MutationRecord[]): void {
    const regions = new Set<Element>();
    for (const m of mutations) {
      const el = m.target instanceof Element ? m.target : m.target.parentElement;
      if (!el || ours(el)) continue;
      const region = safeClosest(el, LIVE_REGION);
      // A region added with its text already in it is usually not announced.
      if (region && !(m.type === 'childList' && [...m.addedNodes].some((n) => n === region || n.contains(region)))) {
        regions.add(region);
      }
    }
    for (const region of regions) {
      const text = region.textContent?.replace(/\s+/g, ' ').trim();
      if (text) announced.push(text.length > 200 ? `${text.slice(0, 199)}…` : text);
    }
    if (announced.length > 50) announced.splice(0, announced.length - 50);
  }

  const observer = new MutationObserver((mutations) => {
    logAnnouncements(mutations);
    checkRemoval();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  doc.addEventListener('focusin', onFocusIn, true);
  doc.addEventListener('focusout', onFocusOut, true);

  // Whatever has focus when the probe starts counts as focused.
  const initial = deepActiveElement(doc);
  if (initial && !onBody(initial) && !ours(initial)) {
    focused = snapshot(initial);
    focusByRoute.set(focused.route, focused);
  }

  function notifyStable(): void {
    if (navigating) return; // already checking a change; it reads the final state
    if (route() === lastRoute) {
      lastTitle = doc.title; // titles are often set after the first render
      return;
    }
    navigating = true;
    const from = lastRoute;
    const titleBefore = lastTitle;
    const before = focusByRoute.get(from);
    later(() => {
      navigating = false;
      const to = route();
      lastRoute = to;
      lastTitle = doc.title;
      for (const key of [...focusByRoute.keys()]) if (key !== to) focusByRoute.delete(key);
      if (to === from) return; // went there and back
      const active = deepActiveElement(doc);
      const lost = onBody(active);
      const focus: NavigationFocus = lost
        ? 'body'
        : active && safeClosest(active, focusTarget)
          ? 'target'
          : 'other';
      const record: NavigationRecord = {
        from,
        to,
        focus,
        focusedTarget: lost || !active ? null : shortSelector(active),
        focusedComponent:
          lost || !active ? null : appComponentFromPath(resolveComponentPath(active), prefixes),
        focusBefore: before?.target ?? null,
        titleBefore,
        titleAfter: doc.title,
        titleChanged: doc.title !== titleBefore,
        // Everything announced since the last change was recorded. An announcer
        // may speak just before the URL updates, so the route isn't checked.
        announcements: [...announced],
      };
      announced.length = 0;
      records.push(record);
      options.onNavigation?.(record);
      // Only when the element that had focus went away with the old view: one
      // that is still in the page (a header link) didn't lose focus by leaving.
      if (lost && before && !before.element.isConnected) {
        report(
          before,
          'ngbr/focus-lost-on-navigation',
          `Focus was lost on the route change from ${from} to ${to}: the element that ` +
            `had focus went away with the old view, and focus fell back to the page ` +
            `body, so the next Tab starts from the top and a screen reader may say ` +
            `nothing. Move focus to the new view's heading or main region after ` +
            `navigation. Heuristic — verify manually.`,
          to,
          false,
        );
      }
    });
  }

  return {
    notifyStable,
    async settled() {
      while (pending.size) await Promise.all([...pending.keys()]);
    },
    records: () => [...records],
    findings: () => [...findings],
    stop() {
      observer.disconnect();
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('focusout', onFocusOut, true);
      for (const { timer, done } of pending.values()) {
        clearTimeout(timer);
        done();
      }
      pending.clear();
    },
  };
}

/** One line for a route change: "/a → /b: focus on body, title unchanged, nothing announced". */
export function describeNavigation(record: NavigationRecord): string {
  const focus =
    record.focus === 'body'
      ? 'focus on body'
      : `focus on ${record.focusedTarget ?? 'an element'}`;
  const title = record.titleChanged ? 'title changed' : 'title unchanged';
  const said = record.announcements.length
    ? `announced "${record.announcements.join(' / ')}"`
    : 'nothing announced';
  return `${record.from} → ${record.to}: ${focus}, ${title}, ${said}`;
}
