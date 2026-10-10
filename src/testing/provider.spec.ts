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

  describe('Focus preview', () => {
    const card = (): HTMLElement | undefined =>
      [...document.querySelectorAll<HTMLElement>('div')].find((d) =>
        d.firstElementChild?.textContent?.startsWith('Focus preview — computed approximation'),
      );
    const menu = (): HTMLElement =>
      document.getElementById(
        document.querySelector('button[aria-label="a11y devtools settings"]')!.getAttribute('aria-controls')!,
      )!;
    const previewToggle = (): HTMLInputElement =>
      [...menu().querySelectorAll('label')]
        .find((l) => l.textContent?.startsWith('Focus preview'))!
        .querySelector('input')!;
    const shortcut = (): void => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { altKey: true, shiftKey: true, key: 'Å', code: 'KeyA', bubbles: true }),
      );
    };

    async function setup(keyboard: boolean): Promise<HTMLButtonElement> {
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          provideA11yDevtools({ root: () => host, logger: makeLogger(), debounceMs: 0, overlay: true, keyboard }),
        ],
      });
      const fixture = TestBed.createComponent(AppComponent);
      host.appendChild(fixture.nativeElement);
      await fixture.whenStable();
      const save = document.createElement('button');
      save.textContent = 'Save';
      host.appendChild(save);
      return save;
    }

    it('turning it on describes the control that was focused before the menu', async () => {
      const save = await setup(false);
      save.focus(); // preview is off (keyboard defaults to false), so no card yet
      await wait(50);
      expect(card()).toBeUndefined();

      await waitFor(() => /1 issue on this page/.test(menu().textContent ?? '')); // first scan done
      const toggle = previewToggle();
      toggle.focus(); // focus moves into our own menu, as a real click would
      toggle.click();

      await waitFor(() => card()?.style.display === 'block');
      expect(card()!.textContent).toContain('"Save"');
    });

    it('turning the tool on describes the focused control without waiting for focus to move', async () => {
      localStorage.setItem(TOGGLE_STORAGE_KEY, 'off');
      const save = await setup(true);
      save.focus();
      shortcut();

      await waitFor(() => card()?.style.display === 'block');
      expect(card()!.textContent).toContain('"Save"');
    });

    it('a control focused mid-scan is described once the scan ends, not with an empty name', async () => {
      const save = await setup(true);
      // Focus while axe.run owns axe's tree, when describing it would fail.
      const axe = (await import('axe-core')).default as unknown as { _tree?: unknown };
      await waitFor(() => !!axe._tree, 5000);
      save.focus();

      await waitFor(() => card()?.style.display === 'block');
      expect(card()!.textContent).toContain('"Save"');
      expect(card()!.textContent).not.toContain('no accessible name');
    });

    it('shows nothing when switched off while waiting for a scan', async () => {
      const save = await setup(true);
      const axe = (await import('axe-core')).default as unknown as { _tree?: unknown };
      await waitFor(() => !!axe._tree, 5000); // a scan is in flight
      save.focus(); // the preview waits on the scan
      previewToggle().click(); // switched off before the scan finishes

      await waitFor(() => !axe._tree && /1 issue on this page/.test(menu().textContent ?? ''));
      await wait(50);
      expect(card()).toBeUndefined();
    });
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

  it('filters highlights by component, and the pill badge counts what the filters let through', async () => {
    // Unattributed (outside any component): a serious keyboard finding.
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

    const description = () => document.getElementById(pill()!.getAttribute('aria-describedby') ?? '')?.textContent;
    const badge = () => [...pill()!.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')].find((s) => /^\d+$/.test(s.textContent ?? ''))!;
    const total = Number(badge().textContent);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(badge().hidden).toBe(false);
    expect(description()).toBe(`${total} issues on this page`);

    const select = document.querySelector<HTMLSelectElement>('[data-ngb-a11y-overlay] select[id$="-component"]')!;
    const label = document.querySelector(`label[for="${select.id}"]`)?.textContent;
    expect(label).toBe('Show component');
    const names = [...select.options].map((o) => o.value);
    expect(names[0]).toBe(''); // All components
    expect(names).toContain('UserCardComponent');
    expect(names).toContain('(unknown component)');

    select.value = 'UserCardComponent';
    select.dispatchEvent(new Event('change'));
    expect(count('serious')).toBe(0);
    expect(count('critical')).toBe(1);
    const matching = Number(badge().textContent);
    expect(matching).toBeLessThan(total);
    expect(badge().style.background).toBe('rgb(211, 32, 41)'); // worst left is critical
    expect(description()).toBe(`${matching} ${matching === 1 ? 'issue' : 'issues'} of ${total} on this page match the filters`);

    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(count('serious')).toBe(1);
    expect(Number(badge().textContent)).toBe(total);

    // Option counts follow the severity filter, like the badge.
    const severity = document.querySelector<HTMLSelectElement>('[data-ngb-a11y-overlay] select[id$="-severity"]')!;
    severity.value = 'critical';
    severity.dispatchEvent(new Event('change'));
    expect([...select.options].map((o) => o.value)).not.toContain('(unknown component)');
    severity.value = 'minor';
    severity.dispatchEvent(new Event('change'));

    // A route change puts the filter back to all components.
    select.value = 'UserCardComponent';
    select.dispatchEvent(new Event('change'));
    const start = location.pathname;
    history.pushState({}, '', '/elsewhere');
    try {
      pill()!.click(); // off
      pill()!.click(); // on: scans straight away
      await waitFor(() => select.value === '');
      expect(Number(badge().textContent)).toBe(total);
    } finally {
      history.pushState({}, '', start);
    }

    // Switched off: no badge and no description.
    pill()!.click();
    expect(badge().hidden).toBe(true);
    expect(pill()!.hasAttribute('aria-describedby')).toBe(false);
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
