/**
 * Keeping the devtools' own UI visible over modals.
 *
 * Native `<dialog>.showModal()` and popovers (which Angular CDK overlays use by
 * default from v22 — Material dialogs, menus, selects) render in the browser's
 * **top layer**, above every z-index. A modal dialog also makes everything
 * outside it inert. So a plain fixed-position overlay ends up hidden under the
 * dialog and the pill can't be clicked. Verified in Chromium: making our UI a
 * popover alone isn't enough while a modal is open (it stays inert); it has to
 * be inside the modal. Outside a modal, it has to be the most recently shown
 * popover to sit on top.
 */

/** Resets the UA popover styles so a popover can act as a full-viewport layer. */
const POPOVER_LAYER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  inset: '0',
  width: '100%',
  height: '100%',
  maxWidth: 'none',
  maxHeight: 'none',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  color: 'inherit',
  overflow: 'visible',
};

/**
 * Every layer this module manages. Their own popover toggles are ignored, or two
 * layers (overlay + pill) would keep re-showing to get above each other.
 */
const managed = new WeakSet<Element>();

/** True if `el` matches `selector`; false if the browser doesn't know the selector. */
function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/** Is this dialog open with `showModal()` (not `show()` or the `open` attribute)? */
export function isModalDialog(el: Element): boolean {
  return el.tagName === 'DIALOG' && safeMatches(el, ':modal');
}

/**
 * The open modal `<dialog>` that blocks the rest of `doc`, or null. With several
 * open, takes the last in document order as the topmost (nested modals are
 * normally opened later and inserted later).
 */
export function blockingModalDialog(
  doc: Document = document,
  isModal: (el: Element) => boolean = isModalDialog,
): HTMLDialogElement | null {
  const open = [...doc.querySelectorAll('dialog[open]')].filter(isModal);
  return (open.at(-1) as HTMLDialogElement | undefined) ?? null;
}

export interface TopLayerOptions {
  /** Document to watch. Defaults to the element's own document. */
  document?: Document;
  /** Override modal detection (tests; jsdom has no `:modal`). */
  isModal?: (el: Element) => boolean;
}

/**
 * Keep `el` (one of the devtools' own layers, already in the document) on top
 * of whatever the app has in the top layer:
 *
 * - it's shown as a manual popover, so it sits in the top layer itself;
 * - while a modal dialog is open it's moved inside that dialog, so it isn't
 *   inert, and moved back to `<body>` when the dialog closes;
 * - when the app shows another popover or dialog, it's re-shown so it stays the
 *   topmost.
 *
 * Falls back to a plain fixed element where popovers aren't supported. Returns a
 * function that stops watching.
 */
export function keepInTopLayer(el: HTMLElement, options: TopLayerOptions = {}): () => void {
  const doc = options.document ?? el.ownerDocument;
  const isModal = options.isModal ?? isModalDialog;
  const canPopover = typeof el.showPopover === 'function';
  managed.add(el);
  if (canPopover) {
    el.setAttribute('popover', 'manual');
    Object.assign(el.style, POPOVER_LAYER_STYLE);
  }

  const show = (): void => {
    if (!canPopover) return;
    try {
      if (safeMatches(el, ':popover-open')) el.hidePopover();
      el.showPopover();
    } catch {
      // Not connected, or the browser refused: stay a plain fixed layer.
    }
  };

  const place = (): void => {
    const parent = blockingModalDialog(doc, isModal) ?? doc.body;
    // Moving a node closes it as a popover, so only move when needed.
    if (el.parentNode !== parent) parent.appendChild(el);
    show();
  };

  // A dialog opening or closing flips its `open` attribute; popovers don't, but
  // they fire `toggle` (it doesn't bubble, so listen in the capture phase).
  const observer = new MutationObserver(place);
  observer.observe(doc.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['open'],
  });
  const onToggle = (event: Event): void => {
    if (event.target instanceof Element && managed.has(event.target)) return;
    if ((event as ToggleEvent).newState === 'open') place();
  };
  doc.addEventListener('toggle', onToggle, true);

  place();

  return () => {
    observer.disconnect();
    doc.removeEventListener('toggle', onToggle, true);
    managed.delete(el);
  };
}

