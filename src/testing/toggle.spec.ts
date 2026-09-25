import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_ATTR } from '../overlay';
import {
  createTogglePill,
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  readStoredEnabled,
  TOGGLE_STORAGE_KEY,
  writeStoredEnabled,
  type TogglePill,
} from '../toggle';

const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('parseShortcut', () => {
  it('reads modifiers and the key, case-insensitively', () => {
    expect(parseShortcut('alt+shift+a')).toEqual({
      alt: true,
      shift: true,
      ctrl: false,
      meta: false,
      key: 'A',
    });
    expect(parseShortcut('Ctrl + Option + F2')).toMatchObject({ ctrl: true, alt: true, key: 'F2' });
    expect(parseShortcut('Cmd+1')).toMatchObject({ meta: true, key: '1' });
  });

  it('returns null for text it cannot read', () => {
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('Alt+Shift')).toBeNull(); // no key
    expect(parseShortcut('A+B')).toBeNull(); // two keys
  });
});

describe('matchesShortcut', () => {
  const altShiftA = parseShortcut('Alt+Shift+A')!;

  it('matches letters on the physical key (macOS Option changes event.key)', () => {
    expect(matchesShortcut(key({ altKey: true, shiftKey: true, key: 'Å', code: 'KeyA' }), altShiftA)).toBe(true);
  });

  it('needs the exact modifiers', () => {
    expect(matchesShortcut(key({ altKey: true, key: 'a', code: 'KeyA' }), altShiftA)).toBe(false);
    expect(
      matchesShortcut(key({ altKey: true, shiftKey: true, ctrlKey: true, key: 'A', code: 'KeyA' }), altShiftA),
    ).toBe(false);
    expect(matchesShortcut(key({ altKey: true, shiftKey: true, key: 'B', code: 'KeyB' }), altShiftA)).toBe(false);
  });

  it('matches digits by code and other keys by name', () => {
    expect(matchesShortcut(key({ metaKey: true, key: '!', code: 'Digit1' }), parseShortcut('Meta+1')!)).toBe(true);
    expect(matchesShortcut(key({ key: 'F2', code: 'F2' }), parseShortcut('F2')!)).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('uses aria-keyshortcuts names in a fixed modifier order', () => {
    expect(formatShortcut(parseShortcut('shift+ctrl+a')!)).toBe('Control+Shift+A');
  });
});

describe('stored on/off choice', () => {
  afterEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    expect(readStoredEnabled(localStorage)).toBeNull();
    writeStoredEnabled(localStorage, false);
    expect(localStorage.getItem(TOGGLE_STORAGE_KEY)).toBe('off');
    expect(readStoredEnabled(localStorage)).toBe(false);
    writeStoredEnabled(localStorage, true);
    expect(readStoredEnabled(localStorage)).toBe(true);
  });

  it('ignores unknown values and never throws when storage is blocked', () => {
    localStorage.setItem(TOGGLE_STORAGE_KEY, 'maybe');
    expect(readStoredEnabled(localStorage)).toBeNull();

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    expect(readStoredEnabled(blocked)).toBeNull();
    expect(() => writeStoredEnabled(blocked, true)).not.toThrow();
  });
});

describe('createTogglePill', () => {
  let pill: TogglePill | undefined;
  const button = (): HTMLButtonElement => document.querySelector('button[role="switch"]')!;

  afterEach(() => {
    pill?.destroy();
    pill = undefined;
  });

  it('renders an accessible switch excluded from scans', () => {
    pill = createTogglePill({ enabled: true, onToggle: () => {}, shortcut: parseShortcut('Alt+Shift+A') });
    const b = button();
    expect(b.hasAttribute(OVERLAY_ATTR)).toBe(true);
    expect(b.getAttribute('aria-label')).toBe('a11y devtools');
    expect(b.textContent).toContain('a11y'); // visible text is part of the name
    expect(b.getAttribute('aria-checked')).toBe('true');
    expect(b.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+A');
    expect(b.textContent).toContain('on'); // state not by colour alone
  });

  it('flips state and reports it on click', () => {
    const onToggle = vi.fn();
    pill = createTogglePill({ enabled: true, onToggle });
    button().click();
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(button().getAttribute('aria-checked')).toBe('false');
    expect(button().textContent).toContain('off');
    expect(button().hasAttribute('aria-keyshortcuts')).toBe(false); // no shortcut given
  });

  it('reflects outside changes and is removed on destroy', () => {
    pill = createTogglePill({ enabled: false, onToggle: () => {}, position: 'top-right' });
    const corner = button().parentElement!; // the pill's group holds the position
    expect(corner.style.top).toBe('12px');
    expect(corner.style.right).toBe('12px');
    pill.setEnabled(true);
    expect(button().getAttribute('aria-checked')).toBe('true');
    pill.destroy();
    pill = undefined;
    expect(button()).toBeNull();
  });
});
