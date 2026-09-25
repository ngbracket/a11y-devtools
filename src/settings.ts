import type { A11yFinding, Impact } from './scan.js';

/** What the overlay draws. Each can be switched from the pill's menu. */
export interface OverlayLayers {
  /** Boxes over flagged elements. */
  highlights: boolean;
  /** Numbered tab-order badges and path. */
  tabOrder: boolean;
  /** The accessibility-tree panel that follows focus. */
  focusPreview: boolean;
}

/** Lowest severity drawn on the page. The console still logs everything. */
export type MinImpact = NonNullable<Impact>;

export interface DevtoolsSettings extends OverlayLayers {
  minImpact: MinImpact;
}

/** `localStorage` key for a developer's own menu choices (only what they changed). */
export const SETTINGS_STORAGE_KEY = 'ngbr-a11y-devtools:settings';

const IMPACT_RANK: Record<MinImpact, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/** Severity choices, least to most severe. */
export const IMPACTS: readonly MinImpact[] = ['minor', 'moderate', 'serious', 'critical'];

/**
 * Is a finding at or above `min`? A finding with no impact is kept only when
 * everything is shown (`minor`).
 */
export function meetsMinImpact(impact: Impact, min: MinImpact): boolean {
  if (!impact) return min === 'minor';
  return IMPACT_RANK[impact] >= IMPACT_RANK[min];
}

/** The findings to draw, given the severity filter. */
export function visibleFindings(findings: A11yFinding[], min: MinImpact): A11yFinding[] {
  return min === 'minor' ? findings : findings.filter((f) => meetsMinImpact(f.impact, min));
}

/**
 * The effective settings: the app's defaults with the developer's remembered
 * changes on top. Unknown or malformed stored values are ignored.
 */
export function resolveSettings(
  defaults: DevtoolsSettings,
  stored: Partial<DevtoolsSettings> | null,
): DevtoolsSettings {
  const out = { ...defaults };
  if (!stored) return out;
  for (const key of ['highlights', 'tabOrder', 'focusPreview'] as const) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key];
  }
  if (stored.minImpact && stored.minImpact in IMPACT_RANK) out.minImpact = stored.minImpact;
  return out;
}

/** The developer's remembered changes, or null. Never throws. */
export function readStoredSettings(storage: Storage | undefined): Partial<DevtoolsSettings> | null {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<DevtoolsSettings>) : null;
  } catch {
    return null;
  }
}

/**
 * Remember only the settings that differ from the app's defaults, so a later
 * change to the defaults still reaches developers who never touched that
 * setting. Silently does nothing if storage is blocked.
 */
export function writeStoredSettings(
  storage: Storage | undefined,
  settings: DevtoolsSettings,
  defaults: DevtoolsSettings,
): void {
  const changed: Partial<Record<keyof DevtoolsSettings, unknown>> = {};
  for (const key of Object.keys(settings) as (keyof DevtoolsSettings)[]) {
    if (settings[key] !== defaults[key]) changed[key] = settings[key];
  }
  try {
    if (Object.keys(changed).length === 0) storage?.removeItem(SETTINGS_STORAGE_KEY);
    else storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(changed));
  } catch {
    // Storage blocked or full: the change still applies, it just isn't remembered.
  }
}
