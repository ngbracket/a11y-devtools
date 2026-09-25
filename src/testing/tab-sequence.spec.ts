import { afterEach, describe, expect, it } from 'vitest';
import {
  isNativelyFocusable,
  isTabbable,
  resolvedTabIndex,
  tabSequence,
  visualOrderJumps,
  type TabStop,
} from '../keyboard/tab-sequence';

/** Build a detached container from an HTML string (no layout needed for ordering). */
function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const alwaysVisible = () => true;

describe('tab-sequence', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves native focusability and tabindex', () => {
    const host = fixture(`
      <a href="#">link</a>
      <a>no href</a>
      <button>b</button>
      <div>plain</div>
      <div tabindex="0">focusable div</div>
      <input type="hidden" />
    `);
    const [linkHref, linkNoHref, button, plain, div, hidden] = [
      ...host.querySelectorAll('a, button, div, input'),
    ];

    expect(isNativelyFocusable(linkHref)).toBe(true);
    expect(isNativelyFocusable(linkNoHref)).toBe(false);
    expect(isNativelyFocusable(button)).toBe(true);
    expect(isNativelyFocusable(plain)).toBe(false);
    expect(isNativelyFocusable(hidden)).toBe(false);

    expect(resolvedTabIndex(button)).toBe(0);
    expect(resolvedTabIndex(plain)).toBe(-1); // not focusable, no tabindex
    expect(resolvedTabIndex(div)).toBe(0);
  });

  it('orders positive tabindex first (ascending), then DOM order for zero/native', () => {
    const host = fixture(`
      <button id="b1">b1</button>
      <a id="a1" href="#">a1</a>
      <input id="i1" tabindex="2" />
      <div id="d1" tabindex="1">d1</div>
    `);
    const order = tabSequence(host, { isVisible: alwaysVisible }).map((s) => s.element.id);
    expect(order).toEqual(['d1', 'i1', 'b1', 'a1']);
  });

  it('marks explicit positive tabindex stops', () => {
    const host = fixture(`
      <div id="d1" tabindex="3">d1</div>
      <button id="b1">b1</button>
    `);
    const byId = new Map(tabSequence(host, { isVisible: alwaysVisible }).map((s) => [s.element.id, s]));
    expect(byId.get('d1')!.positive).toBe(true);
    expect(byId.get('d1')!.tabindex).toBe(3);
    expect(byId.get('b1')!.positive).toBe(false);
  });

  it('excludes disabled, tabindex="-1", [hidden] and [inert] subtrees', () => {
    const host = fixture(`
      <button id="ok">ok</button>
      <button id="disabled" disabled>x</button>
      <button id="minus" tabindex="-1">x</button>
      <button id="hidden" hidden>x</button>
      <div inert><button id="inert">x</button></div>
      <fieldset disabled><button id="fs">x</button></fieldset>
    `);
    const ids = tabSequence(host, { isVisible: alwaysVisible }).map((s) => s.element.id);
    expect(ids).toEqual(['ok']);
  });

  it("leaves out the devtools' own UI (the on/off pill)", () => {
    const host = fixture(`
      <button id="app">app</button>
      <button id="pill" role="switch" data-ngb-a11y-overlay>a11y</button>
    `);
    const ids = tabSequence(host, { isVisible: alwaysVisible }).map((s) => s.element.id);
    expect(ids).toEqual(['app']);
  });

  it('only counts stops inside an open modal dialog (the rest is inert)', () => {
    const host = fixture(`
      <button id="behind">behind</button>
      <dialog open data-modal><button id="in">in</button></dialog>
    `);
    const isModal = (el: Element) => el.hasAttribute('data-modal');
    const ids = tabSequence(host, { isVisible: alwaysVisible, isModal }).map((s) => s.element.id);
    expect(ids).toEqual(['in']);
  });

  it('leaves out focus-trap sentinels unless asked (CDK anchors, focus guards)', () => {
    const host = fixture(`
      <div id="s1" tabindex="0" class="cdk-focus-trap-anchor" aria-hidden="true"></div>
      <button id="real">Save</button>
      <div id="s2" tabindex="0" data-focus-guard></div>
      <div id="labelled" tabindex="0" aria-hidden="true">Not empty</div>
    `);
    const ids = (includeSentinels?: boolean) =>
      tabSequence(host, { isVisible: alwaysVisible, includeSentinels }).map((s) => s.element.id);
    expect(ids()).toEqual(['real', 'labelled']);
    expect(ids(true)).toEqual(['s1', 'real', 's2', 'labelled']);
  });

  it('only counts stops inside an aria-modal kept in by a focus trap (CDK / Material)', () => {
    const host = fixture(`
      <button id="behind">behind</button>
      <div class="cdk-overlay-pane">
        <div tabindex="0" aria-hidden="true"></div>
        <div role="dialog" aria-modal="true"><input id="name" /><button id="save">Save</button></div>
        <div tabindex="0" aria-hidden="true"></div>
      </div>
    `);
    const ids = tabSequence(host, { isVisible: alwaysVisible }).map((s) => s.element.id);
    expect(ids).toEqual(['name', 'save']);
  });

  it('isTabbable honours the visibility predicate', () => {
    const host = fixture(`<button id="b">b</button>`);
    const button = host.querySelector('#b')!;
    expect(isTabbable(button, () => true)).toBe(true);
    expect(isTabbable(button, () => false)).toBe(false);
  });

  it('flags visual-order jumps using injected rects', () => {
    // Three stops whose tab order is 1,2,3 but stop 3 sits visually above stop 2.
    const stops = [
      { element: {} as Element },
      { element: {} as Element },
      { element: {} as Element },
    ] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number }>([
      [stops[0].element, { top: 0, left: 0 }],
      [stops[1].element, { top: 200, left: 0 }],
      [stops[2].element, { top: 10, left: 0 }], // jumps back up the page
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([2]);
  });

  it('does not treat moving up into the next column as a jump', () => {
    // A sidebar (left column) then the main content, or a multi-column footer:
    // the last link of one column is followed by the top of the next.
    const stops = [
      { element: {} as Element },
      { element: {} as Element },
      { element: {} as Element },
    ] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number }>([
      [stops[0].element, { top: 100, left: 80 }], // sidebar, near the top
      [stops[1].element, { top: 800, left: 80 }], // sidebar, last link
      [stops[2].element, { top: 120, left: 400 }], // main column, first link
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([]);
  });

  it('still flags moving up when the stop overlaps the previous one horizontally', () => {
    const stops = [{ element: {} as Element }, { element: {} as Element }] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number; right?: number }>([
      [stops[0].element, { top: 400, left: 8, right: 140 }], // a wide button lower down
      [stops[1].element, { top: 60, left: 30, right: 80 }], // up, slightly right, same column
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([1]);
  });

  it('compares where a wrapped link ends with where the next one starts', () => {
    // Link 1 wraps: it starts at the end of line 1 and ends at the start of line 2;
    // link 2 follows it on line 2. Its bounding box would start at the left edge.
    const stops = [{ element: {} as Element }, { element: {} as Element }] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number; right?: number; endTop?: number; endLeft?: number }>([
      [stops[0].element, { top: 100, left: 600, right: 700, endTop: 128, endLeft: 300 }],
      [stops[1].element, { top: 128, left: 420 }],
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([]);
  });

  it('still flags moving up and to the left', () => {
    const stops = [{ element: {} as Element }, { element: {} as Element }] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number }>([
      [stops[0].element, { top: 500, left: 400 }],
      [stops[1].element, { top: 100, left: 80 }],
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([1]);
  });

  it('reports no jumps for a top-to-bottom order', () => {
    const stops = [{ element: {} as Element }, { element: {} as Element }] as unknown as TabStop[];
    const rects = new Map<Element, { top: number; left: number }>([
      [stops[0].element, { top: 0, left: 0 }],
      [stops[1].element, { top: 50, left: 0 }],
    ]);
    expect(visualOrderJumps(stops, (el) => rects.get(el)!)).toEqual([]);
  });
});
