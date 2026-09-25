import { OVERLAY_ATTR } from './overlay.js';
import { keepInTopLayer } from './top-layer.js';
import { createPillMenu, type PillMenuOptions, type PillMenuStatus } from './pill-menu.js';

/** Default keyboard shortcut that turns the devtools on/off. */
export const DEFAULT_TOGGLE_SHORTCUT = 'Alt+Shift+A';

/** `localStorage` key holding the remembered on/off choice (`'on'` | `'off'`). */
export const TOGGLE_STORAGE_KEY = 'ngbr-a11y-devtools';

/** Where the on/off pill sits in the viewport. */
export type PillPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/** A parsed shortcut such as `Alt+Shift+A`. */
export interface Shortcut {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  /** The non-modifier key, upper-cased when it's a single character (e.g. `A`, `1`, `F2`). */
  key: string;
}

const MODIFIERS: Record<string, keyof Omit<Shortcut, 'key'>> = {
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/**
 * Parse `Alt+Shift+A`-style text. Case-insensitive; exactly one non-modifier key.
 * Returns null for anything it can't read, so a typo disables the shortcut
 * rather than throwing inside the app.
 */
export function parseShortcut(text: string): Shortcut | null {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const shortcut: Shortcut = { alt: false, shift: false, ctrl: false, meta: false, key: '' };
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (mod) {
      shortcut[mod] = true;
    } else if (!shortcut.key) {
      shortcut.key = part.length === 1 ? part.toUpperCase() : part;
    } else {
      return null; // two non-modifier keys
    }
  }
  return shortcut.key ? shortcut : null;
}

/**
 * Does a keydown match the shortcut? Letters and digits match on the physical
 * key (`event.code`), because Alt/Option changes `event.key` on macOS
 * (Alt+Shift+A reports `Å`) and on some keyboard layouts.
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (
    event.altKey !== shortcut.alt ||
    event.shiftKey !== shortcut.shift ||
    event.ctrlKey !== shortcut.ctrl ||
    event.metaKey !== shortcut.meta
  ) {
    return false;
  }
  const { key } = shortcut;
  if (/^[A-Z]$/.test(key)) return event.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}`;
  return event.key.toLowerCase() === key.toLowerCase();
}

/** The same shortcut in `aria-keyshortcuts` / display form, e.g. `Alt+Shift+A`. */
export function formatShortcut(shortcut: Shortcut): string {
  const mods = [
    shortcut.ctrl && 'Control',
    shortcut.alt && 'Alt',
    shortcut.shift && 'Shift',
    shortcut.meta && 'Meta',
  ].filter(Boolean);
  return [...mods, shortcut.key].join('+');
}

/**
 * The remembered on/off choice, or null if there isn't one (or storage is
 * blocked, e.g. a private window). Never throws.
 */
export function readStoredEnabled(storage: Storage | undefined): boolean | null {
  try {
    const value = storage?.getItem(TOGGLE_STORAGE_KEY);
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch {
    return null;
  }
}

/** Remember the on/off choice. Silently does nothing if storage is blocked. */
export function writeStoredEnabled(storage: Storage | undefined, enabled: boolean): void {
  try {
    storage?.setItem(TOGGLE_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage blocked or full: the toggle still works, it just isn't remembered.
  }
}

export interface TogglePillOptions {
  /** Document to render into. Defaults to the global `document`. */
  document?: Document;
  /** Initial state. */
  enabled: boolean;
  /** Called with the new state when the user clicks the pill. */
  onToggle: (enabled: boolean) => void;
  /** Shortcut shown in the tooltip and exposed via `aria-keyshortcuts`. */
  shortcut?: Shortcut | null;
  /** Default `bottom-left` (the focus-follow panel uses bottom-right). */
  position?: PillPosition;
  /** Add the `⋯` settings menu next to the switch. */
  menu?: Omit<PillMenuOptions, 'opensUp' | 'alignLeft'>;
}

export interface TogglePill {
  /** Reflect a state change made elsewhere (e.g. the keyboard shortcut). */
  setEnabled(enabled: boolean): void;
  /** Update the menu's issue and page counts (no-op without a menu). */
  setStatus(status: PillMenuStatus): void;
  destroy(): void;
}

const PILL_ON = '#3ecf8e';
const PILL_OFF = '#8a8f98';

/**
 * A small on/off switch for the devtools, fixed to a corner of the page. A real
 * `<button role="switch">` so it works by keyboard and screen reader: the
 * accessible name is "a11y devtools" (it contains the visible "a11y"), state is
 * `aria-checked`, and the visible on/off text means state doesn't rely on colour.
 * Marked with {@link OVERLAY_ATTR} so scans never report the tool's own UI.
 */
export function createTogglePill(options: TogglePillOptions): TogglePill {
  const doc = options.document ?? document;
  const position = options.position ?? 'bottom-left';
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'right'];

  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute(OVERLAY_ATTR, '');
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'a11y devtools');
  const keys = options.shortcut ? formatShortcut(options.shortcut) : null;
  if (keys) button.setAttribute('aria-keyshortcuts', keys);
  Object.assign(button.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: '28px',
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '999px',
    background: 'rgba(20,22,28,0.94)',
    color: '#f4f4f5',
    font: '600 12px/1 ui-sans-serif, system-ui, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });

  const dot = doc.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%' });
  const name = doc.createElement('span');
  name.textContent = 'a11y';
  // The state word is visible for sighted users; assistive tech gets it from
  // aria-checked, so it's hidden to avoid "a11y on, switch, on".
  const state = doc.createElement('span');
  state.setAttribute('aria-hidden', 'true');
  state.style.fontWeight = '400';
  button.append(dot, name, state);

  // Inline styles can't do :focus-visible, so draw the ring from focus events,
  // only when the browser would show one.
  button.addEventListener('focus', () => {
    if (button.matches(':focus-visible')) {
      button.style.outline = '2px solid #7ab8ff';
      button.style.outlineOffset = '2px';
    }
  });
  button.addEventListener('blur', () => {
    button.style.outline = '';
  });

  let enabled = options.enabled;
  function setEnabled(next: boolean): void {
    enabled = next;
    button.setAttribute('aria-checked', String(enabled));
    dot.style.background = enabled ? PILL_ON : PILL_OFF;
    state.textContent = enabled ? 'on' : 'off';
    button.style.opacity = enabled ? '1' : '0.75';
    button.title = `a11y devtools ${enabled ? 'on' : 'off'}${keys ? ` (${keys})` : ''}`;
  }
  setEnabled(enabled);

  button.addEventListener('click', () => {
    setEnabled(!enabled);
    options.onToggle(enabled);
  });

  // A click-through full-viewport layer holds the pill, so the layer (not the
  // button) becomes the top-layer popover and the button keeps its corner.
  const layer = doc.createElement('div');
  layer.setAttribute(OVERLAY_ATTR, '');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  // The switch, the optional menu button and its panel sit together in a corner.
  const group = doc.createElement('div');
  Object.assign(group.style, {
    position: 'fixed',
    [vertical]: '12px',
    [horizontal]: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  });
  group.appendChild(button);
  const menu = options.menu
    ? createPillMenu(doc, { ...options.menu, opensUp: vertical === 'bottom', alignLeft: horizontal === 'left' })
    : undefined;
  if (menu) group.append(menu.button, menu.panel);
  layer.appendChild(group);
  doc.body.appendChild(layer);
  const releaseTopLayer = keepInTopLayer(layer, { document: doc });

  return {
    setEnabled,
    setStatus: (status) => menu?.setStatus(status),
    destroy: () => {
      menu?.destroy();
      releaseTopLayer();
      layer.remove();
    },
  };
}
