import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, OVERLAY_ATTR, type A11yOverlay } from '../overlay';
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

  it('draws a numbered tab-order badge per stop, centred on its target', () => {
    const a = targetEl('a', { top: 100, left: 50, width: 20, height: 20 });
    const b = targetEl('b', { top: 200, left: 60, width: 20, height: 20 });
    overlay.renderTabOrder([stop(a, { order: 1 }), stop(b, { order: 2 })]);

    const badges = overlayRoot()!.querySelectorAll('[data-ngb-tab-order]');
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe('1');
    const first = badges[0] as HTMLElement;
    expect(first.style.top).toBe('100px'); // anchored at the target's top-left
    expect(first.style.left).toBe('50px');
  });

  it('colours a positive-tabindex stop as a warning', () => {
    const a = targetEl('a');
    overlay.renderTabOrder([stop(a, { order: 1, positive: true, tabindex: 3 })]);
    const badge = overlayRoot()!.querySelector('[data-ngb-tab-order]') as HTMLElement;
    expect(badge.style.background).toContain('rgb(232, 113, 10)'); // #e8710a warn
    expect(badge.title).toContain('hijacks order');
  });

  it('draws a connector polyline through the stop centres', () => {
    const a = targetEl('a', { top: 100, left: 50, width: 20, height: 20 });
    const b = targetEl('b', { top: 200, left: 60, width: 20, height: 20 });
    overlay.renderTabOrder([stop(a, { order: 1 }), stop(b, { order: 2 })]);
    const line = overlayRoot()!.querySelector('polyline') as SVGPolylineElement;
    expect(line.getAttribute('points')).toBe('60,110 70,210');
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
});
