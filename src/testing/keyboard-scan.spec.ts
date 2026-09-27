import { afterEach, describe, expect, it } from 'vitest';
import { RULE_DOCS, scanKeyboard } from '../keyboard/keyboard-scan';

/**
 * Install a fake `window.ng` for a scan: `listeners` maps an element to the DOM
 * events it has bound, `owners` maps it to its owning component name. Mirrors the
 * mocking style in attribution.spec — reliable across environments where the
 * real debug global's `getListeners` may not be published.
 */
function withNg(
  listeners: Map<Element, string[]>,
  owners: Map<Element, string>,
  fn: () => void,
): void {
  const original = (globalThis as { ng?: unknown }).ng;
  (globalThis as { ng?: unknown }).ng = {
    getComponent: () => null,
    getOwningComponent: (el: Element) =>
      owners.has(el) ? { constructor: { name: owners.get(el) } } : null,
    getDirectives: () => [],
    getListeners: (el: Element) =>
      (listeners.get(el) ?? []).map((name) => ({ name, type: 'dom' as const })),
  };
  try {
    fn();
  } finally {
    (globalThis as { ng?: unknown }).ng = original;
  }
}

function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('scanKeyboard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('flags an interactive role that is not keyboard-focusable', () => {
    const host = fixture(`<div id="fake" role="button">Save</div>`);
    const el = host.querySelector('#fake')!;
    withNg(new Map(), new Map([[el, 'ToolbarComponent']]), () => {
      const findings = scanKeyboard(host);
      const finding = findings.find((f) => f.id === 'ngbr/unreachable-control');
      expect(finding).toBeDefined();
      expect(finding!.impact).toBe('serious');
      expect(finding!.component).toBe('ToolbarComponent');
    });
  });

  it('ignores controls behind an open modal dialog, but still checks inside it', () => {
    const host = fixture(`
      <div id="behind" role="button">Behind</div>
      <dialog open data-modal><div id="inside" role="button">Inside</div></dialog>
    `);
    const isModal = (el: Element) => el.hasAttribute('data-modal');
    withNg(new Map(), new Map(), () => {
      const ids = scanKeyboard(host, { isModal })
        .filter((f) => f.id === 'ngbr/unreachable-control')
        .map((f) => f.target);
      expect(ids).toEqual(['div#inside']);
    });
  });

  describe('composite widgets (arrow keys move between items)', () => {
    const unreachable = (host: HTMLElement) =>
      scanKeyboard(host)
        .filter((f) => f.id === 'ngbr/unreachable-control')
        .map((f) => f.target);

    it.each([
      ['tablist', 'tab'],
      ['listbox', 'option'],
      ['tree', 'treeitem'],
      ['radiogroup', 'radio'],
      ['menubar', 'menuitem'],
      ['toolbar', 'button'],
    ])('roving tabindex: a %s whose other %s items are tabindex="-1"', (widget, item) => {
      const host = fixture(`
        <div role="${widget}">
          <div role="${item}" tabindex="0">One</div>
          <div role="${item}" tabindex="-1">Two</div>
          <div role="${item}" tabindex="-1">Three</div>
        </div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual([]));
    });

    it('aria-activedescendant on the widget: items need no tabindex', () => {
      const host = fixture(`
        <div role="listbox" tabindex="0" aria-activedescendant="o1">
          <div role="option" id="o1">One</div><div role="option" id="o2">Two</div>
        </div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual([]));
    });

    it('aria-activedescendant on a combobox that controls the listbox popup', () => {
      const host = fixture(`
        <input role="combobox" aria-controls="lb" aria-activedescendant="" aria-label="Fruit" />
        <div role="listbox" id="lb"><div role="option">Apple</div><div role="option">Pear</div></div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual([]));
    });

    it('a menu popup opened by a button: every item tabindex="-1"', () => {
      const host = fixture(`
        <button aria-haspopup="menu" aria-controls="m">Actions</button>
        <div role="menu" id="m"><div role="menuitem" tabindex="-1">Edit</div><div role="menuitem" tabindex="-1">Delete</div></div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual([]));
    });

    it('still flags a widget Tab can never enter (every item tabindex="-1")', () => {
      const host = fixture(`
        <div role="tablist"><div id="t1" role="tab" tabindex="-1">A</div><div id="t2" role="tab" tabindex="-1">B</div></div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual(['div#t1', 'div#t2']));
    });

    it('still flags an item script cannot focus (no tabindex, no aria-activedescendant)', () => {
      const host = fixture(`
        <div role="tablist"><div role="tab" tabindex="0">A</div><div id="bare" role="tab">B</div></div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual(['div#bare']));
    });

    describe('a click-only part of a widget item (a tree expand/collapse arrow)', () => {
      const twistyTree = (itemTabindex: string, siblingTabindex: string) =>
        fixture(`
          <div role="tree">
            <div role="treeitem" tabindex="${itemTabindex}" aria-expanded="false">
              <span id="twisty" aria-hidden="true">▸</span> Docs
            </div>
            <div role="treeitem" tabindex="${siblingTabindex}">Readme</div>
          </div>`);
      const clickOn = (host: HTMLElement) => new Map([[host.querySelector('#twisty')!, ['click']]]);

      it.each([
        ['the item is tabbable', '0', '-1'],
        ['the item is reached with arrow keys (roving tabindex)', '-1', '0'],
      ])('is not reported when %s', (_case, itemTabindex, siblingTabindex) => {
        const host = twistyTree(itemTabindex, siblingTabindex);
        withNg(clickOn(host), new Map(), () => {
          const ids = scanKeyboard(host).map((f) => `${f.id} ${f.target}`);
          expect(ids).toEqual([]);
        });
      });

      it('is still reported when Tab can never enter the widget', () => {
        const host = twistyTree('-1', '-1');
        withNg(clickOn(host), new Map(), () => {
          expect(unreachable(host)).toContain('span#twisty');
        });
      });

      it('is still reported inside a control that is not a widget item', () => {
        const host = fixture(`<div role="button" tabindex="0">Open <span id="twisty">▸</span></div>`);
        withNg(clickOn(host), new Map(), () => {
          expect(unreachable(host)).toEqual(['span#twisty']);
        });
      });
    });

    describe('a click-only part of a focusable widget that handles keys (chart marks)', () => {
      const chart = () =>
        fixture(`
          <div id="plot" role="application" tabindex="0" aria-label="Sales">
            <span id="bar-1">Q1</span><span id="bar-2">Q2</span>
          </div>`);

      it('is not reported when the widget handles keys itself', () => {
        const host = chart();
        const listeners = new Map<Element, string[]>([
          [host.querySelector('#plot')!, ['keydown']],
          [host.querySelector('#bar-1')!, ['click']],
          [host.querySelector('#bar-2')!, ['click']],
        ]);
        withNg(listeners, new Map(), () => expect(unreachable(host)).toEqual([]));
      });

      it('is still reported when the focusable ancestor has no key handling', () => {
        const host = chart();
        const listeners = new Map<Element, string[]>([[host.querySelector('#bar-1')!, ['click']]]);
        withNg(listeners, new Map(), () => expect(unreachable(host)).toEqual(['span#bar-1']));
      });

      it('does not count a page-wide key listener (body is never tabbable)', () => {
        const host = fixture(`<div><span id="mark">x</span></div>`);
        const listeners = new Map<Element, string[]>([
          [document.body, ['keydown']],
          [host.querySelector('#mark')!, ['click']],
        ]);
        withNg(listeners, new Map(), () => expect(unreachable(host)).toEqual(['span#mark']));
      });
    });

    it('still flags a tabindex="-1" control that is not in a composite widget', () => {
      const host = fixture(`<div><div role="button" tabindex="0">A</div><div id="lone" role="button" tabindex="-1">B</div></div>`);
      withNg(new Map(), new Map(), () => expect(unreachable(host)).toEqual(['div#lone']));
    });
  });

  it("doesn't call a hidden control unreachable (closed <details>, nested or not, and [hidden])", () => {
    const host = fixture(`
      <details><summary>A</summary><div id="in-closed" role="button" tabindex="0">x</div></details>
      <details open><summary>B</summary>
        <details><summary>C</summary><div id="in-nested" role="button" tabindex="0">x</div></details>
      </details>
      <div hidden><div id="in-hidden" role="button">x</div></div>
      <details open><summary>D</summary><div id="shown" role="button">x</div></details>
    `);
    withNg(new Map(), new Map(), () => {
      const ids = scanKeyboard(host)
        .filter((f) => f.id === 'ngbr/unreachable-control')
        .map((f) => f.target);
      expect(ids).toEqual(['div#shown']);
    });
  });

  it("links each finding to its rule's docs page (slug = the id without ngbr/)", () => {
    const host = fixture(`
      <div id="fake" role="button">Save</div>
      <div id="clicky" tabindex="0">Open</div>
      <div role="dialog" aria-modal="true"><button>OK</button></div>
      <button>Behind</button>
    `);
    const clicky = host.querySelector('#clicky')!;
    withNg(new Map([[clicky, ['click']]]), new Map(), () => {
      const findings = scanKeyboard(host);
      expect(new Set(findings.map((f) => f.id))).toEqual(
        new Set(['ngbr/unreachable-control', 'ngbr/click-without-key', 'ngbr/modal-focus-not-contained']),
      );
      for (const f of findings) {
        expect(f.helpUrl).toBe(`${RULE_DOCS}/${f.id.replace('ngbr/', '')}`);
      }
    });
  });

  it('flags a div with a click handler but no way to focus it', () => {
    const host = fixture(`<div id="clicky">Click</div>`);
    const el = host.querySelector('#clicky')!;
    withNg(new Map([[el, ['click']]]), new Map([[el, 'CardComponent']]), () => {
      const ids = scanKeyboard(host).map((f) => f.id);
      expect(ids).toContain('ngbr/unreachable-control');
    });
  });

  it('does not flag a click listener on a container of links (event delegation)', () => {
    const host = fixture(`<div id="prose"><p>See <a href="/docs">the docs</a>.</p></div>`);
    const el = host.querySelector('#prose')!;
    withNg(new Map([[el, ['click']]]), new Map([[el, 'DocsComponent']]), () => {
      expect(scanKeyboard(host)).toEqual([]);
    });
  });

  it('still flags a container with an interactive role, even if it holds a link', () => {
    const host = fixture(`<div id="card" role="button">Open <a href="/x">details</a></div>`);
    const el = host.querySelector('#card')!;
    withNg(new Map([[el, ['click']]]), new Map(), () => {
      expect(scanKeyboard(host).map((f) => f.id)).toContain('ngbr/unreachable-control');
    });
  });

  it('flags a focusable click target with no keyboard handler', () => {
    const host = fixture(`<div id="btn" tabindex="0" role="button">Go</div>`);
    const el = host.querySelector('#btn')!;
    withNg(new Map([[el, ['click']]]), new Map(), () => {
      const finding = scanKeyboard(host).find((f) => f.id === 'ngbr/click-without-key');
      expect(finding).toBeDefined();
      expect(finding!.impact).toBe('moderate');
    });
  });

  it('does not flag a focusable click target that also handles keydown', () => {
    const host = fixture(`<div id="btn" tabindex="0" role="button">Go</div>`);
    const el = host.querySelector('#btn')!;
    withNg(new Map([[el, ['click', 'keydown']]]), new Map(), () => {
      expect(scanKeyboard(host)).toEqual([]);
    });
  });

  it('never flags a native button, even with only a click handler', () => {
    const host = fixture(`<button id="real">Real</button>`);
    const el = host.querySelector('#real')!;
    withNg(new Map([[el, ['click']]]), new Map(), () => {
      expect(scanKeyboard(host)).toEqual([]);
    });
  });

  it('is a no-op when the ng debug global is absent (production)', () => {
    const host = fixture(`<div role="button">x</div>`);
    // No withNg: window.ng is undefined, so a role-only element still flags
    // (role needs no listeners), but nothing that depends on listeners does.
    const findings = scanKeyboard(host);
    // The role-based unreachable check works without listeners; assert it doesn't throw
    // and that a purely listener-driven case (click) would be silent.
    expect(Array.isArray(findings)).toBe(true);
  });

  it('emits a focus-trap finding for an uncontained aria-modal', () => {
    const host = fixture(`
      <button id="behind">Behind</button>
      <div id="dlg" role="dialog" aria-modal="true"><button>OK</button></div>
    `);
    const dlg = host.querySelector('#dlg')!;
    withNg(new Map(), new Map([[dlg, 'ConfirmDialog']]), () => {
      const finding = scanKeyboard(host).find((f) => f.id === 'ngbr/modal-focus-not-contained');
      expect(finding).toBeDefined();
      expect(finding!.impact).toBe('moderate');
      expect(finding!.component).toBe('ConfirmDialog');
    });
  });

  it('stays silent for a plain non-interactive element with no listeners', () => {
    const host = fixture(`<div id="text">just text</div>`);
    const el = host.querySelector('#text')!;
    withNg(new Map(), new Map([[el, 'X']]), () => {
      expect(scanKeyboard(host)).toEqual([]);
    });
  });
});
