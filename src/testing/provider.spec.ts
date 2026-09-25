import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideA11yDevtools } from '../provider';
import type { Logger } from '../report';
import { TOGGLE_STORAGE_KEY } from '../toggle';
import { SETTINGS_STORAGE_KEY } from '../settings';
import { AppComponent } from './fixtures';

const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await wait();
  }
  throw new Error('waitFor timed out');
}

describe('provideA11yDevtools', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    localStorage.clear();
  });

  const makeLogger = (): Logger => ({
    groupCollapsed: vi.fn(),
    groupEnd: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  });

  const pill = (): HTMLButtonElement | null => document.querySelector('button[role="switch"]');

  it('scans and reports by component when the app stabilizes', async () => {
    const logger: Logger = {
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger, debounceMs: 0 }),
      ],
    });

    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    await waitFor(() => (logger.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls.length > 0);

    expect(logger.groupCollapsed).toHaveBeenCalledWith(
      expect.stringContaining('UserCardComponent'),
    );
  });

  it('does not scan when the remembered choice is off; the shortcut turns it on and remembers', async () => {
    localStorage.setItem(TOGGLE_STORAGE_KEY, 'off');
    const logger = makeLogger();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger, debounceMs: 0 }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    await wait(150);

    expect(logger.groupCollapsed).not.toHaveBeenCalled();
    expect(pill()?.getAttribute('aria-checked')).toBe('false');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, key: 'Å', code: 'KeyA', bubbles: true }),
    );

    await waitFor(() => (logger.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(localStorage.getItem(TOGGLE_STORAGE_KEY)).toBe('on');
    expect(pill()?.getAttribute('aria-checked')).toBe('true');
  });

  it('respects enabled:false, pill:false and shortcut:false', async () => {
    const logger = makeLogger();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger, debounceMs: 0, enabled: false, pill: false, shortcut: false }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, key: 'A', code: 'KeyA', bubbles: true }),
    );
    await wait(150);

    expect(pill()).toBeNull();
    expect(logger.groupCollapsed).not.toHaveBeenCalled();
  });

  it('removes the pill when the app is destroyed', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger: makeLogger(), debounceMs: 0 }),
      ],
    });
    TestBed.createComponent(AppComponent);
    expect(pill()).not.toBeNull();
    TestBed.resetTestingModule();
    expect(pill()).toBeNull();
  });

  it('clears the overlay when switched off from the pill', async () => {
    const logger = makeLogger();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger, debounceMs: 0, overlay: true }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const boxes = (): number => document.querySelectorAll('[data-impact]').length;
    await waitFor(() => boxes() > 0);

    pill()!.click();
    expect(boxes()).toBe(0);
    expect(localStorage.getItem(TOGGLE_STORAGE_KEY)).toBe('off');
  });

  it('draws per the layer defaults, and a menu change redraws and is remembered', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({
          root: () => host,
          logger: makeLogger(),
          debounceMs: 0,
          overlay: true,
          layers: { highlights: false },
        }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const menu = (): HTMLElement =>
      document.getElementById(
        document.querySelector('button[aria-label="a11y devtools settings"]')!.getAttribute('aria-controls')!,
      )!;
    // Scanned (the menu counts the issue) but nothing drawn: highlights are off.
    await waitFor(() => /1 issue on this page/.test(menu().textContent ?? ''));
    expect(document.querySelectorAll('[data-impact]').length).toBe(0);

    const highlights = [...menu().querySelectorAll('label')].find((l) => l.textContent?.startsWith('Highlights'))!;
    highlights.querySelector('input')!.click();
    expect(document.querySelectorAll('[data-impact]').length).toBe(1); // redrawn, no rescan
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({ highlights: true });
  });

  it('filters highlights by the minimum severity chosen in the menu', async () => {
    // A role="button" that can't be focused is a serious keyboard finding,
    // next to the fixture's critical image-alt.
    const fake = document.createElement('div');
    fake.setAttribute('role', 'button');
    fake.textContent = 'Fake button';
    host.appendChild(fake);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger: makeLogger(), debounceMs: 0, overlay: true, keyboard: true }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const count = (impact: string): number => document.querySelectorAll(`[data-impact="${impact}"]`).length;
    await waitFor(() => count('critical') > 0 && count('serious') > 0);

    const select = document.querySelector<HTMLSelectElement>('[data-ngb-a11y-overlay] select')!;
    select.value = 'critical';
    select.dispatchEvent(new Event('change'));
    expect(count('serious')).toBe(0);
    expect(count('critical')).toBe(1);
  });

  it('rescans when a native dialog closes outside Angular (e.g. Escape)', async () => {
    const logger = makeLogger();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideA11yDevtools({ root: () => host, logger, debounceMs: 0 }),
      ],
    });
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const scans = (): number => (logger.groupCollapsed as ReturnType<typeof vi.fn>).mock.calls.length;
    await waitFor(() => scans() > 0);
    await wait(100);
    const before = scans();

    const dialog = document.createElement('dialog');
    host.appendChild(dialog);
    dialog.dispatchEvent(new Event('close')); // what Escape fires; Angular never sees it
    await waitFor(() => scans() > before);
  });
});
