import { afterEach, describe, expect, it } from 'vitest';
import {
  meetsMinImpact,
  readStoredSettings,
  resolveSettings,
  SETTINGS_STORAGE_KEY,
  visibleFindings,
  writeStoredSettings,
  type DevtoolsSettings,
} from '../settings';
import type { A11yFinding } from '../scan';

const defaults: DevtoolsSettings = { highlights: true, tabOrder: false, focusPreview: true, minImpact: 'minor' };

const finding = (impact: A11yFinding['impact']): A11yFinding => ({
  id: 'x',
  impact,
  help: '',
  helpUrl: '',
  component: null,
  directives: [],
  target: '#t',
  html: '',
});

describe('severity filter', () => {
  it('keeps findings at or above the minimum', () => {
    expect(meetsMinImpact('serious', 'moderate')).toBe(true);
    expect(meetsMinImpact('moderate', 'serious')).toBe(false);
    expect(meetsMinImpact('critical', 'critical')).toBe(true);
  });

  it('keeps findings with no impact only when showing everything', () => {
    expect(meetsMinImpact(null, 'minor')).toBe(true);
    expect(meetsMinImpact(null, 'moderate')).toBe(false);
  });

  it('filters a list', () => {
    const all = [finding('minor'), finding('serious'), finding('critical')];
    expect(visibleFindings(all, 'minor')).toHaveLength(3);
    expect(visibleFindings(all, 'serious').map((f) => f.impact)).toEqual(['serious', 'critical']);
  });
});

describe('resolveSettings', () => {
  it('layers stored choices over the defaults and ignores junk', () => {
    expect(resolveSettings(defaults, null)).toEqual(defaults);
    expect(resolveSettings(defaults, { tabOrder: true, minImpact: 'serious' })).toEqual({
      ...defaults,
      tabOrder: true,
      minImpact: 'serious',
    });
    const junk = { highlights: 'no', minImpact: 'huge' } as unknown as Partial<DevtoolsSettings>;
    expect(resolveSettings(defaults, junk)).toEqual(defaults);
  });
});

describe('stored settings', () => {
  afterEach(() => localStorage.clear());

  it('remembers only what differs from the defaults', () => {
    writeStoredSettings(localStorage, { ...defaults, tabOrder: true }, defaults);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({ tabOrder: true });
    expect(readStoredSettings(localStorage)).toEqual({ tabOrder: true });
  });

  it('clears the key when everything is back to default', () => {
    writeStoredSettings(localStorage, { ...defaults, tabOrder: true }, defaults);
    writeStoredSettings(localStorage, defaults, defaults);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('never throws on bad JSON or blocked storage', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{nope');
    expect(readStoredSettings(localStorage)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(readStoredSettings(blocked)).toBeNull();
    expect(() => writeStoredSettings(blocked, defaults, defaults)).not.toThrow();
  });
});
