import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, OVERLAY_ATTR, resolveLabelStack, type A11yOverlay, type LabelBox } from '../overlay';
import type { A11yFinding } from '../scan';
import type { TabStop } from '../keyboard/tab-sequence';

const stop = (element: Element, over: Partial<TabStop> = {}): TabStop => ({
  element,
  order: 1,
  tabindex: 0,
  positive: false,
  component: null,
  componentPath: [],
  ...over,
});

const finding = (over: Partial<A11yFinding>): A11yFinding => ({
  id: 'image-alt',
  impact: 'critical',
  help: 'Images must have alternate text',
  helpUrl: 'https://example.test/image-alt',
  component: 'UserCardComponent',
  directives: [],
  target: '#target',
  html: '<img>',
  ...over,
});

/** A node the overlay can resolve, with a stubbed layout rect (jsdom has none). */
function targetEl(id: string, rect: Partial<DOMRect> = {}): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  const box = { top: 10, left: 20, width: 100, height: 40, ...rect } as DOMRect;
  el.getBoundingClientRect = () => box;
  document.body.appendChild(el);
  return el;
}

function overlayRoot(): HTMLElement | null {
  return document.querySelector(`[${OVERLAY_ATTR}]`);
}

describe('createOverlay', () => {
  let overlay: A11yOverlay;

  beforeEach(() => {
    overlay = createOverlay();
  });

  afterEach(() => {
    overlay.destroy();
    document.body.innerHTML = '';
  });

  it('marks its root with the exclude attribute so scans skip it', () => {
    expect(overlayRoot()).not.toBeNull();
  });

  it('draws one box per finding, positioned over the target', () => {
    targetEl('target', { top: 15, left: 25, width: 120, height: 30 });
    overlay.render([finding({ target: '#target' })]);

    const boxes = overlayRoot()!.querySelectorAll('[data-impact]');
    expect(boxes).toHaveLength(1);
    const box = boxes[0] as HTMLElement;
    expect(box.style.top).toBe('15px');
    expect(box.style.left).toBe('25px');
    expect(box.style.width).toBe('120px');
    expect(box.style.height).toBe('30px');
  });

  it('colours the box by impact and labels it with the component', () => {
    targetEl('target');
    overlay.render([finding({ impact: 'serious', component: 'NavBarComponent' })]);

    const box = overlayRoot()!.querySelector('[data-impact="serious"]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.border).toContain('rgb(232, 113, 10)'); // #e8710a
    expect(box.textContent).toBe('NavBarComponent · image-alt');
  });

  it('skips findings whose target no longer exists', () => {
    overlay.render([finding({ target: '#gone' })]);
    expect(overlayRoot()!.querySelectorAll('[data-impact]')).toHaveLength(0);
  });

  it('replaces the previous highlights on each render', () => {
    targetEl('target');
    overlay.render([finding({}), finding({ id: 'color-contrast' })]);
    expect(overlayRoot()!.querySelectorAll('[data-impact]')).toHaveLength(2);

    overlay.render([finding({})]);
    expect(overlayRoot()!.querySelectorAll('[data-impact]')).toHaveLength(1);
  });

  it('scrolls the offending node into view when its box is clicked', () => {
    const el = targetEl('target');
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    overlay.render([finding({ target: '#target' })]);
    const box = overlayRoot()!.querySelector('[data-impact]') as HTMLElement;
    box.click();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  });

  it('removes its container on destroy', () => {
    overlay.destroy();
    expect(overlayRoot()).toBeNull();
  });

  describe('resolveLabelStack (findings labels never cover each other)', () => {
    const box = (over: Partial<LabelBox>): LabelBox => ({ left: 100, width: 80, baseTop: 200, height: 16, ...over });

    it('leaves a single label at its natural top', () => {
      expect(resolveLabelStack([box({ baseTop: 200 })])).toEqual([200]);
    });

    it('pushes an overlapping label up so both stay readable', () => {
      // Two labels at the same x, almost the same top → the second is lifted clear.
      const tops = resolveLabelStack([box({ baseTop: 200, height: 16 }), box({ baseTop: 202, height: 16 })]);
      expect(tops[0]).toBe(200); // first (topmost) stays put
      expect(tops[1]).toBeLessThan(tops[0]); // second lifted above the first
      expect(tops[1] + 16).toBeLessThanOrEqual(tops[0]); // …and no longer overlapping it
    });

    it('does not move labels that are far apart', () => {
      expect(resolveLabelStack([box({ baseTop: 100 }), box({ baseTop: 400 })])).toEqual([100, 400]);
    });

    it('does not move labels that share a row but not a column', () => {
      // Same top, but non-overlapping x-ranges → no collision.
      const tops = resolveLabelStack([box({ left: 0, width: 50, baseTop: 300 }), box({ left: 200, width: 50, baseTop: 300 })]);
      expect(tops).toEqual([300, 300]);
    });
  });

  it('draws a numbered tab-order badge per stop, on the left edge of its target', () => {
    const a = targetEl('a', { top: 100, left: 50, width: 20, height: 20 });
    const b = targetEl('b', { top: 200, left: 60, width: 20, height: 20 });
    overlay.renderTabOrder([stop(a, { order: 1 }), stop(b, { order: 2 })]);

    const badges = overlayRoot()!.querySelectorAll('[data-ngb-tab-order]');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe('1');
    const first = badges[0] as HTMLElement;
    // Just outside the left edge, vertically centred — clear of the findings
    // labels at the top-left. x = left - gutter(10), y = top + height/2.
    expect(first.style.top).toBe('110px');
    expect(first.style.left).toBe('40px');
  });

  it('clamps a tab-order badge into the viewport for a control flush to the left', () => {
    const a = targetEl('a', { top: 300, left: 2, width: 40, height: 20 });
    overlay.renderTabOrder([stop(a, { order: 1 })]);
    const badge = overlayRoot()!.querySelector('[data-ngb-tab-order]') as HTMLElement;
    expect(badge.style.left).toBe('9px'); // clamped to min x, not 2 - 10 = -8
  });

  it('colours a positive-tabindex stop as a warning', () => {
    const a = targetEl('a');
    overlay.renderTabOrder([stop(a, { order: 1, positive: true, tabindex: 3 })]);
    const badge = overlayRoot()!.querySelector('[data-ngb-tab-order]') as HTMLElement;
    expect(badge.style.background).toContain('rgb(232, 113, 10)'); // #e8710a warn
    expect(badge.title).toContain('hijacks order');
  });

  it('threads a connector polyline through the badge anchor points', () => {
    const a = targetEl('a', { top: 100, left: 50, width: 20, height: 20 });
    const b = targetEl('b', { top: 200, left: 60, width: 20, height: 20 });
    overlay.renderTabOrder([stop(a, { order: 1 }), stop(b, { order: 2 })]);
    const line = overlayRoot()!.querySelector('polyline') as SVGPolylineElement;
    // Anchors: (left - gutter(10), top + height/2) per stop.
    expect(line.getAttribute('points')).toBe('40,110 50,210');
  });

  it('clears the tab-order layer independently of the findings highlights', () => {
    const a = targetEl('a');
    overlay.render([finding({ target: '#a' })]);
    overlay.renderTabOrder([stop(a, { order: 1 })]);
    expect(overlayRoot()!.querySelectorAll('[data-ngb-tab-order]')).toHaveLength(1);

    overlay.clearTabOrder();
    expect(overlayRoot()!.querySelectorAll('[data-ngb-tab-order]')).toHaveLength(0);
    expect(overlayRoot()!.querySelectorAll('[data-impact]')).toHaveLength(1); // highlights untouched
  });

  it('renders the accessibility-tree panel with an honest, non-SR header', () => {
    overlay.renderAxPanel({
      role: 'button',
      name: 'Save',
      description: '',
      states: ['disabled'],
      component: 'ToolbarComponent',
      tag: 'div',
    });
    const text = overlayRoot()!.textContent ?? '';
    expect(text.toLowerCase()).toContain('computed approximation'); // honesty guardrail
    expect(text).toContain('button');
    expect(text).toContain('"Save"');
    expect(text).toContain('disabled');
    expect(text).toContain('ToolbarComponent');
  });

  it('flags a missing accessible name in the panel', () => {
    overlay.renderAxPanel({ role: 'button', name: '', description: '', states: [], component: null, tag: 'div' });
    expect(overlayRoot()!.textContent).toContain('(no accessible name)');
  });

  it('hides the panel when passed null', () => {
    overlay.renderAxPanel({ role: 'link', name: 'Home', description: '', states: [], component: null, tag: 'a' });
    overlay.renderAxPanel(null);
    expect(overlayRoot()!.textContent).not.toContain('Home');
  });
});
