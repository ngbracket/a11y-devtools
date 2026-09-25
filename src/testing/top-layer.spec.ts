import { afterEach, describe, expect, it } from 'vitest';
import { blockingModalDialog, keepInTopLayer } from '../top-layer';

// jsdom has no showModal() or :modal, so "modal" is marked with a data attribute.
const isModal = (el: Element): boolean => el.hasAttribute('data-modal');
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // MutationObserver delivery

function dialog(id: string, { open = false, modal = false } = {}): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.id = id;
  if (modal) d.setAttribute('data-modal', '');
  if (open) d.setAttribute('open', '');
  document.body.appendChild(d);
  return d;
}

describe('blockingModalDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is null with no open modal', () => {
    dialog('closed', { modal: true });
    dialog('non-modal', { open: true });
    expect(blockingModalDialog(document, isModal)).toBeNull();
  });

  it('takes the last open modal as the topmost', () => {
    dialog('a', { open: true, modal: true });
    dialog('b', { open: true, modal: true });
    expect(blockingModalDialog(document, isModal)?.id).toBe('b');
  });

  it('does not throw where :modal is unsupported (default check)', () => {
    dialog('x', { open: true });
    expect(() => blockingModalDialog(document)).not.toThrow();
  });
});

describe('keepInTopLayer', () => {
  let release: (() => void) | undefined;

  afterEach(() => {
    release?.();
    release = undefined;
    document.body.innerHTML = '';
  });

  it('moves into a modal dialog while it is open, and back to <body> when it closes', async () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const d = dialog('d', { modal: true });
    release = keepInTopLayer(layer, { isModal });
    expect(layer.parentElement).toBe(document.body);

    d.setAttribute('open', '');
    await flush();
    expect(layer.parentElement).toBe(d); // inside the modal, so not inert

    d.removeAttribute('open');
    await flush();
    expect(layer.parentElement).toBe(document.body);
  });

  it('leaves non-modal dialogs alone, and stops watching when released', async () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const plain = dialog('plain');
    const modal = dialog('m', { modal: true });
    release = keepInTopLayer(layer, { isModal });

    plain.setAttribute('open', '');
    await flush();
    expect(layer.parentElement).toBe(document.body);

    release();
    release = undefined;
    modal.setAttribute('open', '');
    await flush();
    expect(layer.parentElement).toBe(document.body);
  });

  it('is a plain layer where popovers are unsupported (no popover attribute)', () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    release = keepInTopLayer(layer, { isModal });
    expect(layer.hasAttribute('popover')).toBe(false);
  });
});
