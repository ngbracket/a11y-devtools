import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTogglePill, type TogglePill } from '../toggle';
import type { DevtoolsSettings } from '../settings';

const settings: DevtoolsSettings = { highlights: true, tabOrder: false, focusPreview: true, minImpact: 'minor' };

describe('pill settings menu', () => {
  let pill: TogglePill | undefined;
  const menuButton = (): HTMLButtonElement => document.querySelector('button[aria-label="a11y devtools settings"]')!;
  const panel = (): HTMLElement => document.getElementById(menuButton().getAttribute('aria-controls')!)!;

  function open(over: { onChange?: (s: DevtoolsSettings) => void; onDownload?: () => void } = {}) {
    pill = createTogglePill({
      enabled: true,
      onToggle: () => {},
      menu: { settings, onChange: over.onChange ?? (() => {}), onDownload: over.onDownload ?? (() => {}) },
    });
  }

  afterEach(() => {
    pill?.destroy();
    pill = undefined;
  });

  it('is a disclosure: collapsed by default, expands on click', () => {
    open();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(panel().hidden).toBe(true);
    menuButton().click();
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hidden).toBe(false);
  });

  it('reports layer and severity changes as whole settings', () => {
    const onChange = vi.fn();
    open({ onChange });
    const tabOrder = [...panel().querySelectorAll('label')].find((l) => l.textContent?.startsWith('Tab order'))!;
    const box = tabOrder.querySelector('input')!;
    expect(document.getElementById(box.getAttribute('aria-labelledby')!)?.textContent).toBe('Tab order');
    expect(document.getElementById(box.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Numbered path through the page',
    );
    expect(box.checked).toBe(false);
    box.click();
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, tabOrder: true });

    const select = panel().querySelector('select')!;
    expect(panel().querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Show issues');
    select.value = 'serious';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenLastCalledWith({ ...settings, tabOrder: true, minImpact: 'serious' });
  });

  it('closes on Escape (focus back on the button) and on an outside click', () => {
    open();
    menuButton().click();
    const select = panel().querySelector('select')!;
    select.focus();
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(menuButton());

    menuButton().click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel().hidden).toBe(true);
  });

  it('shows counts and enables download once a page is recorded', () => {
    const onDownload = vi.fn();
    open({ onDownload });
    const download = [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Download report')!;
    pill!.setStatus({ found: 0, shown: 0, pages: 0 });
    expect(download.disabled).toBe(true);

    pill!.setStatus({ found: 5, shown: 2, pages: 3 });
    expect(panel().textContent).toContain('5 issues on this page, 2 shown');
    expect(panel().textContent).toContain('Covers 3 pages');
    download.click();
    expect(onDownload).toHaveBeenCalled();
  });

  it('has no menu unless asked', () => {
    pill = createTogglePill({ enabled: true, onToggle: () => {} });
    expect(document.querySelector('button[aria-label="a11y devtools settings"]')).toBeNull();
    expect(() => pill!.setStatus({ found: 1, shown: 1, pages: 1 })).not.toThrow();
  });
});
