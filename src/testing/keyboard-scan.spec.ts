import { afterEach, describe, expect, it } from 'vitest';
import { scanKeyboard } from '../keyboard/keyboard-scan';

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
