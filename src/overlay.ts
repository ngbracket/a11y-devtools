import type { A11yFinding, Impact } from './scan.js';

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

export interface A11yOverlay {
  /** Draw a highlight over each finding's node, replacing the previous set. */
  render(findings: A11yFinding[]): void;
  /** Remove all highlights but keep the overlay live. */
  clear(): void;
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

  let highlights: Highlight[] = [];

  const reposition = () => {
    for (const { target, box } of highlights) {
      positionBox(box, target);
    }
  };

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
  }

  function destroy(): void {
    clear();
    win?.removeEventListener('scroll', onViewportChange, { capture: true } as EventListenerOptions);
    win?.removeEventListener('resize', onViewportChange);
    container.remove();
  }

  return { render, clear, destroy };
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
