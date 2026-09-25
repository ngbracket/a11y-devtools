import type { A11yFinding, Impact } from './scan.js';
import type { TabStop } from './keyboard/tab-sequence.js';
import type { AxDescription } from './keyboard/accname.js';
import { keepInTopLayer } from './top-layer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Tab-order path + badge colours: normal teal, warning orange for positive tabindex. */
const TAB_ORDER_COLOR = '#0b8f8f';
const TAB_ORDER_WARN_COLOR = '#e8710a';
/** How far outside a control's left edge the tab-order badge sits, and its min viewport x. */
const TAB_BADGE_GUTTER = 10;
const TAB_BADGE_MIN_X = 9;
/** Highest a de-collided finding label may be pushed (viewport y), so labels stay on-screen. */
const LABEL_MIN_TOP = 2;

/**
 * Attribute marking the overlay's own DOM. `scan()` excludes anything under it
 * so the tool never reports violations against its own highlights.
 */
export const OVERLAY_ATTR = 'data-ngb-a11y-overlay';

/** Selector form of {@link OVERLAY_ATTR}, passed to axe as an exclude. */
export const OVERLAY_EXCLUDE_SELECTOR = `[${OVERLAY_ATTR}]`;

/** Border/label colour per axe impact. `null` impact falls back to `none`. */
const IMPACT_COLOR: Record<NonNullable<Impact> | 'none', string> = {
  critical: '#d32029',
  serious: '#e8710a',
  moderate: '#c9a227',
  minor: '#3b7dd8',
  none: '#8a8a8a',
};

function colorFor(impact: Impact): string {
  return IMPACT_COLOR[impact ?? 'none'];
}

/** A rendered highlight paired with the node and finding it points at. */
interface Highlight {
  finding: A11yFinding;
  target: Element;
  box: HTMLElement;
}

/** A rendered tab-order badge paired with the stop it marks. */
interface TabBadge {
  stop: TabStop;
  target: Element;
  badge: HTMLElement;
}

/** The computed accessibility-tree info shown in the focus-follow panel. */
export interface AxPanelData extends AxDescription {
  /** Owning component of the focused element, or null. */
  component: string | null;
  /** Tag name of the focused element, for context (e.g. `div`, `button`). */
  tag: string;
}

export interface A11yOverlay {
  /** Draw a highlight over each finding's node, replacing the previous set. */
  render(findings: A11yFinding[]): void;
  /**
   * Draw the tab order as numbered badges plus a connector path, on a layer
   * independent of the findings highlights. Replaces the previous tab-order set.
   */
  renderTabOrder(stops: TabStop[]): void;
  /**
   * Show the accessibility-tree preview panel for the focused element, or hide it
   * when passed `null`. Deliberately framed as a *computed approximation* — see
   * the panel header — never as verbatim screen-reader output.
   */
  renderAxPanel(data: AxPanelData | null): void;
  /** Remove all highlights but keep the overlay live. */
  clear(): void;
  /** Remove the tab-order layer but keep the overlay live. */
  clearTabOrder(): void;
  /** Tear down: remove the container and detach scroll/resize listeners. */
  destroy(): void;
}

export interface OverlayOptions {
  /** Document to render into. Defaults to the global `document`. */
  document?: Document;
}

/**
 * A dev-only visual overlay: absolutely-positioned boxes drawn over the nodes
 * axe flagged, coloured by impact, click-to-scroll to the offending element.
 * Plain DOM — no Angular component — so it stays framework-agnostic, carries no
 * change-detection cost, and its own DOM is trivially excluded from scans via
 * {@link OVERLAY_ATTR}. Boxes reposition on scroll/resize so they track their
 * targets as the page moves.
 */
export function createOverlay(options: OverlayOptions = {}): A11yOverlay {
  const doc = options.document ?? document;

  const container = doc.createElement('div');
  container.setAttribute(OVERLAY_ATTR, '');
  Object.assign(container.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none', // pass clicks through; individual boxes opt back in
    zIndex: '2147483646',
  });
  doc.body.appendChild(container);
  // Stay visible over native modal dialogs and CDK/Material popover overlays,
  // which render in the browser's top layer above any z-index.
  const releaseTopLayer = keepInTopLayer(container, { document: doc });

  // The tab-order connector lives on its own SVG layer under the badges, so the
  // findings highlights and the tab-order path render and clear independently.
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute(OVERLAY_ATTR, '');
  Object.assign(svg.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
  });
  const connector = doc.createElementNS(SVG_NS, 'polyline');
  connector.setAttribute('fill', 'none');
  connector.setAttribute('stroke', TAB_ORDER_COLOR);
  connector.setAttribute('stroke-width', '2');
  connector.setAttribute('stroke-dasharray', '4 3');
  connector.setAttribute('opacity', '0.7');
  svg.appendChild(connector);
  container.appendChild(svg); // under the badges, which are appended later

  // The accessibility-tree preview panel: a fixed card that follows focus. Hidden
  // until renderAxPanel is called with data. Marked with OVERLAY_ATTR so scans
  // never flag the tool's own UI.
  const axPanel = doc.createElement('div');
  axPanel.setAttribute(OVERLAY_ATTR, '');
  Object.assign(axPanel.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    maxWidth: '320px',
    padding: '8px 10px',
    borderRadius: '6px',
    background: 'rgba(20,22,28,0.94)',
    color: '#f4f4f5',
    font: '12px/1.5 ui-sans-serif, system-ui, sans-serif',
    boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    display: 'none',
  });
  container.appendChild(axPanel);

  let highlights: Highlight[] = [];
  let tabBadges: TabBadge[] = [];

  const reposition = () => {
    for (const { target, box } of highlights) {
      positionBox(box, target);
    }
    decollideLabels();
    repositionTabOrder();
  };

  /**
   * Push overlapping finding labels apart so none is hidden behind another —
   * the demo (and any dense page) stacks several findings at the same top-left
   * spot, and previously the later label simply covered the earlier one. Measures
   * each label, resolves non-overlapping tops via {@link resolveLabelStack}, and
   * applies the extra upward shift as a transform (the label's default is
   * `translateY(-100%)`, sitting just above its box).
   */
  function decollideLabels(): void {
    const labels: HTMLElement[] = [];
    const boxes: LabelBox[] = [];
    for (const { target, box } of highlights) {
      const label = box.firstElementChild as HTMLElement | null;
      if (!label) continue;
      const rect = target.getBoundingClientRect();
      labels.push(label);
      boxes.push({ left: rect.left, width: label.offsetWidth, baseTop: rect.top - label.offsetHeight, height: label.offsetHeight });
    }
    const tops = resolveLabelStack(boxes);
    for (let i = 0; i < labels.length; i++) {
      const extraUp = boxes[i].baseTop - tops[i]; // >= 0
      labels[i].style.transform =
        extraUp > 0 ? `translateY(calc(-100% - ${extraUp}px))` : 'translateY(-100%)';
    }
  }

  function repositionTabOrder(): void {
    const points: string[] = [];
    for (const { target, badge } of tabBadges) {
      const rect = target.getBoundingClientRect();
      // Anchor the badge just OUTSIDE the left edge, vertically centred, so it
      // clears the findings labels that sit along the top-left corner (a
      // corner-anchored badge collided with them). Clamp x into the viewport so a
      // control flush to the left edge still shows its badge. The connector
      // threads these same points.
      const y = rect.top + rect.height / 2;
      const x = Math.max(TAB_BADGE_MIN_X, rect.left - TAB_BADGE_GUTTER);
      badge.style.top = `${y}px`;
      badge.style.left = `${x}px`;
      points.push(`${x},${y}`);
    }
    connector.setAttribute('points', points.join(' '));
  }

  // rAF-throttle so a stream of scroll events collapses to one layout read.
  const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
  let scheduled = false;
  const onViewportChange = () => {
    if (!raf) {
      reposition();
      return;
    }
    if (scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      reposition();
    });
  };

  const win = doc.defaultView;
  win?.addEventListener('scroll', onViewportChange, { passive: true, capture: true });
  win?.addEventListener('resize', onViewportChange, { passive: true });

  function clear(): void {
    for (const { box } of highlights) box.remove();
    highlights = [];
  }

  function render(findings: A11yFinding[]): void {
    clear();
    for (const finding of findings) {
      const target = resolveTarget(doc, finding.target);
      if (!target) continue; // node gone since the scan (e.g. re-rendered)
      const box = buildBox(doc, finding);
      box.addEventListener('click', () => flashAndScroll(target, box));
      container.appendChild(box);
      positionBox(box, target);
      highlights.push({ finding, target, box });
    }
    decollideLabels();
  }

  function clearTabOrder(): void {
    for (const { badge } of tabBadges) badge.remove();
    tabBadges = [];
    connector.setAttribute('points', '');
  }

  function renderTabOrder(stops: TabStop[]): void {
    clearTabOrder();
    for (const stop of stops) {
      const target = stop.element;
      if (!target.isConnected) continue; // node gone since the sequence was computed
      const badge = buildBadge(doc, stop);
      container.appendChild(badge);
      tabBadges.push({ stop, target, badge });
    }
    repositionTabOrder();
  }

  function renderAxPanel(data: AxPanelData | null): void {
    if (!data) {
      axPanel.style.display = 'none';
      axPanel.replaceChildren();
      return;
    }
    axPanel.replaceChildren(...buildAxPanelContent(doc, data));
    axPanel.style.display = 'block';
  }

  function destroy(): void {
    clear();
    clearTabOrder();
    renderAxPanel(null);
    win?.removeEventListener('scroll', onViewportChange, { capture: true } as EventListenerOptions);
    win?.removeEventListener('resize', onViewportChange);
    releaseTopLayer();
    container.remove();
  }

  return { render, renderTabOrder, renderAxPanel, clear, clearTabOrder, destroy };
}

/** The rows of the accessibility-tree preview panel, honesty header first. */
function buildAxPanelContent(doc: Document, data: AxPanelData): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  const header = doc.createElement('div');
  header.textContent = 'Accessibility-tree preview — computed approximation';
  Object.assign(header.style, {
    fontWeight: '700',
    fontSize: '10px',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: '#a9b0bd',
    marginBottom: '4px',
  });
  header.title = 'A computed name/role/state — an approximation of what assistive tech announces, not any one screen reader.';
  nodes.push(header);

  const row = (label: string, value: string, muted = false): HTMLElement => {
    const div = doc.createElement('div');
    const key = doc.createElement('span');
    key.textContent = `${label}: `;
    key.style.color = '#a9b0bd';
    const val = doc.createElement('span');
    val.textContent = value;
    if (muted) val.style.color = '#e8710a'; // draw the eye to a missing name
    div.append(key, val);
    return div;
  };

  nodes.push(row('role', data.role ?? `(none — <${data.tag}>)`));
  nodes.push(
    data.name
      ? row('name', `"${data.name}"`)
      : row('name', '(no accessible name)', true),
  );
  if (data.description) nodes.push(row('description', `"${data.description}"`));
  if (data.states.length) nodes.push(row('states', data.states.join(', ')));
  if (data.component) nodes.push(row('component', data.component));

  return nodes;
}

/**
 * A numbered badge marking one tab stop, anchored at the target's top-left
 * corner. A positive-tabindex stop is coloured as a warning, since an explicit
 * positive tabindex hijacks the natural order.
 */
function buildBadge(doc: Document, stop: TabStop): HTMLElement {
  const color = stop.positive ? TAB_ORDER_WARN_COLOR : TAB_ORDER_COLOR;
  const badge = doc.createElement('div');
  badge.setAttribute('data-ngb-tab-order', String(stop.order));
  const owner = stop.component ? ` · ${stop.component}` : '';
  const ti = stop.positive ? ` · tabindex=${stop.tabindex} (hijacks order)` : '';
  badge.title = `Tab stop ${stop.order}${owner}${ti}`;
  badge.textContent = String(stop.order);
  Object.assign(badge.style, {
    position: 'fixed',
    transform: 'translate(-50%, -50%)',
    minWidth: '16px',
    height: '16px',
    padding: '0 3px',
    boxSizing: 'border-box',
    borderRadius: '8px',
    font: '10px/16px ui-monospace, monospace',
    fontWeight: '700',
    textAlign: 'center',
    color: '#fff',
    background: color,
    border: '1px solid rgba(255,255,255,0.85)',
    pointerEvents: 'none',
  });
  return badge;
}

/** Resolve a finding's target selector to a node, tolerating a bad selector. */
function resolveTarget(doc: Document, target: string): Element | null {
  try {
    return doc.querySelector(target);
  } catch {
    return null;
  }
}

function buildBox(doc: Document, finding: A11yFinding): HTMLElement {
  const color = colorFor(finding.impact);
  const box = doc.createElement('div');
  box.setAttribute('data-impact', finding.impact ?? 'none');
  box.title = `${finding.id}: ${finding.help}`;
  Object.assign(box.style, {
    position: 'fixed',
    boxSizing: 'border-box',
    border: `2px solid ${color}`,
    borderRadius: '2px',
    background: `${color}1a`, // ~10% alpha
    pointerEvents: 'auto',
    cursor: 'pointer',
  });

  const label = doc.createElement('span');
  label.textContent = finding.component
    ? `${finding.component} · ${finding.id}`
    : finding.id;
  Object.assign(label.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    transform: 'translateY(-100%)',
    padding: '1px 4px',
    font: '11px/1.4 ui-monospace, monospace',
    color: '#fff',
    background: color,
    whiteSpace: 'nowrap',
  });
  box.appendChild(label);
  return box;
}

/** One finding label's box for stacking: its natural top-left and measured size. */
export interface LabelBox {
  /** Viewport left of the label (its box's left edge). */
  left: number;
  /** Measured label width. */
  width: number;
  /** The label's natural top (just above its box) with no de-collision shift. */
  baseTop: number;
  /** Measured label height. */
  height: number;
}

/**
 * Resolve overlapping finding labels to non-overlapping vertical positions,
 * returning the adjusted top for each input (in input order). Labels are walked
 * top-to-bottom and each is pushed *up* until it clears the ones already placed,
 * so a cluster of flagged nodes stacks its labels instead of hiding them behind
 * one another. Pure geometry — no DOM — so it's unit-testable. Pushing stops at
 * `minTop` to keep labels on-screen (a dense cluster may then still overlap).
 */
export function resolveLabelStack(items: LabelBox[], minTop = LABEL_MIN_TOP): number[] {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.baseTop - b.it.baseTop || a.it.left - b.it.left);
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const tops = new Array<number>(items.length);
  for (const { it, i } of order) {
    let top = it.baseTop;
    const hits = (t: number): boolean =>
      placed.some(
        (p) => it.left < p.right && it.left + it.width > p.left && t < p.bottom && t + it.height > p.top,
      );
    let guard = 0;
    while (hits(top) && top > minTop && guard++ < 60) top -= it.height + 2;
    tops[i] = top;
    placed.push({ left: it.left, right: it.left + it.width, top, bottom: top + it.height });
  }
  return tops;
}

/** Anchor `box` (position:fixed) over `target` using viewport coordinates. */
function positionBox(box: HTMLElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  Object.assign(box.style, {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

/** Scroll the offending node into view and briefly emphasise its highlight. */
function flashAndScroll(target: Element, box: HTMLElement): void {
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const original = box.style.boxShadow;
  box.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.6)';
  box.ownerDocument.defaultView?.setTimeout(() => {
    box.style.boxShadow = original;
  }, 600);
}
