import { afterEach, describe, expect, it } from 'vitest';
import { findUncontainedModals } from '../keyboard/focus-trap';

function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

// jsdom has no layout, so bypass the layout-visibility check; structural
// exclusions (inert/hidden/disabled) still apply — which is what we're testing.
const alwaysVisible = { isVisible: () => true };

describe('findUncontainedModals', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('flags an aria-modal with tabbable elements still reachable outside it', () => {
    const host = fixture(`
      <button id="behind">Page button behind the modal</button>
      <div id="dlg" role="dialog" aria-modal="true">
        <button>OK</button>
      </div>
    `);
    const found = findUncontainedModals(host, alwaysVisible);
    expect(found).toHaveLength(1);
    expect((found[0].element as HTMLElement).id).toBe('dlg');
    expect(found[0].insideCount).toBe(1);
    expect(found[0].outsideCount).toBe(1);
  });

  it('does not flag a modal when the background is marked inert', () => {
    // A correctly-implemented modal inerts the rest of the page, so the outside
    // button is not tabbable and there is no leak. tabSequence drops inert subtrees.
    const host = fixture(`
      <div inert>
        <button id="behind">Behind</button>
      </div>
      <div role="dialog" aria-modal="true">
        <button>OK</button>
      </div>
    `);
    expect(findUncontainedModals(host, alwaysVisible)).toEqual([]);
  });

  it('does not flag a modal with no tabbable content of its own', () => {
    const host = fixture(`
      <button id="behind">Behind</button>
      <div role="dialog" aria-modal="true"><p>Just a message</p></div>
    `);
    expect(findUncontainedModals(host, alwaysVisible)).toEqual([]);
  });

  it('ignores a non-modal dialog (no aria-modal="true")', () => {
    const host = fixture(`
      <button id="behind">Behind</button>
      <div role="dialog"><button>OK</button></div>
    `);
    expect(findUncontainedModals(host, alwaysVisible)).toEqual([]);
  });

  it('returns nothing when there are no tabbable stops at all', () => {
    const host = fixture(`<div role="dialog" aria-modal="true"><p>text</p></div>`);
    expect(findUncontainedModals(host, alwaysVisible)).toEqual([]);
  });
});
