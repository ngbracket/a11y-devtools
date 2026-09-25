import {
  ApplicationRef,
  DestroyRef,
  type EnvironmentProviders,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import type { RunOptions as AxeRunOptions } from 'axe-core';
import { debounceTime, filter } from 'rxjs';
import { runA11yScan } from './runner.js';
import type { Logger } from './report.js';
import { createOverlay, OVERLAY_ATTR } from './overlay.js';
import { tabSequence } from './keyboard/tab-sequence.js';
import { describeElement } from './keyboard/accname.js';
import { resolveOwningComponentName } from './attribution.js';
import {
  createTogglePill,
  DEFAULT_TOGGLE_SHORTCUT,
  matchesShortcut,
  parseShortcut,
  readStoredEnabled,
  writeStoredEnabled,
  type PillPosition,
} from './toggle.js';
import {
  readStoredSettings,
  resolveSettings,
  visibleFindings,
  writeStoredSettings,
  type DevtoolsSettings,
  type MinImpact,
  type OverlayLayers,
} from './settings.js';
import type { A11yFinding } from './scan.js';
import type { PageReport } from './report/format.js';

export interface A11yDevtoolsOptions {
  /** Element/Document to scan. Defaults to `document`. */
  root?: () => Element | Document;
  /** Log grouped findings to the console. Default true. */
  log?: boolean;
  /** Sink for reporting; defaults to `console`. */
  logger?: Logger;
  /** Draw an in-app visual overlay over each flagged node. Default false. */
  overlay?: boolean;
  /** Quiet window after stabilization before scanning. Default 500ms. */
  debounceMs?: number;
  /**
   * Restrict the scan to specific axe tags, e.g. `['wcag22aa']` or
   * `['wcag21aa', 'best-practice']`. Omit to run axe-core's default ruleset —
   * the machine-testable rules across WCAG 2.0/2.1/2.2 (Levels A & AA) plus axe's
   * best-practice rules. (For finer control, call `runA11yScan`/`scan` with full
   * axe run options.)
   */
  tags?: string[];
  /**
   * Component-name prefixes treated as third-party UI primitives to walk past
   * during attribution. Defaults to `Nb`/`Mat`/`Cdk`/`Mdc`. Add others (e.g.
   * `Nz`/`Clr`/`Ion`) or pass `[]` to attribute to the immediate owner — useful
   * when auditing a component library's own code.
   */
  frameworkPrefixes?: readonly string[];
  /**
   * Turn on the **keyboard layer** — the ~2/3 of accessibility axe can't test.
   * Adds heuristic `ngbr/*` findings (keyboard-unreachable controls,
   * click-without-keyboard handlers, tab-order mismatches) to the report, and,
   * when `overlay` is on, draws the numbered tab-order path over the page.
   * Default false.
   */
  keyboard?: boolean;
  /**
   * Start switched on. Default true. Only used when the developer hasn't toggled
   * it yet: once they switch it on or off (pill or shortcut), that choice is
   * remembered in `localStorage` and wins over this default on reload.
   */
  enabled?: boolean;
  /**
   * Show the on/off pill. Default `'bottom-left'`; pass another corner to move
   * it, or `false` to hide it (the shortcut still works).
   */
  pill?: PillPosition | false;
  /**
   * Keyboard shortcut that turns the devtools on/off. Default `'Alt+Shift+A'`.
   * Modifiers: `Alt`, `Shift`, `Ctrl`, `Meta`. Pass `false` to disable it.
   */
  shortcut?: string | false;
  /**
   * What the overlay draws by default. Developers can change each from the
   * pill's menu; their choice is remembered and wins over these defaults.
   * Defaults: `highlights: true`; `tabOrder` and `focusPreview` follow `keyboard`.
   */
  layers?: Partial<OverlayLayers>;
  /**
   * Lowest severity drawn on the page by default: `'minor'` (everything),
   * `'moderate'`, `'serious'` or `'critical'`. The console still logs every
   * issue. Developers can change it from the pill's menu. Default `'minor'`.
   */
  minImpact?: MinImpact;
}

/**
 * Dev-only in-app accessibility auditing. Rescans whenever the application
 * settles (zoneless-aware, via `ApplicationRef.isStable`) and reports each
 * violation against the component that rendered it.
 *
 * In production this is a no-op and axe-core is never loaded, so it carries no
 * runtime weight. For a hard guarantee, include the provider only in your dev
 * bootstrap config.
 */
export function provideA11yDevtools(options: A11yDevtoolsOptions = {}): EnvironmentProviders {
  if (!isDevMode()) {
    return makeEnvironmentProviders([]);
  }

  const {
    root,
    log = true,
    logger,
    overlay = false,
    debounceMs = 500,
    tags,
    frameworkPrefixes,
    keyboard = false,
    enabled: enabledByDefault = true,
    pill = 'bottom-left',
    shortcut: shortcutText = DEFAULT_TOGGLE_SHORTCUT,
    layers = {},
    minImpact = 'minor',
  } = options;
  const defaultSettings: DevtoolsSettings = {
    highlights: layers.highlights ?? true,
    tabOrder: layers.tabOrder ?? keyboard,
    focusPreview: layers.focusPreview ?? keyboard,
    minImpact,
  };
  const axe: AxeRunOptions | undefined = tags
    ? { runOnly: { type: 'tag', values: tags } }
    : undefined;

  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const appRef = inject(ApplicationRef);
      const destroyRef = inject(DestroyRef);

      const overlayView = overlay ? createOverlay() : undefined;

      // On/off switch. Off = no scanning and nothing drawn, so it costs nothing
      // while hidden. The developer's last choice is remembered per origin.
      const storage = safeLocalStorage();
      let enabled = readStoredEnabled(storage) ?? enabledByDefault;
      const shortcut = shortcutText ? parseShortcut(shortcutText) : null;

      // What's drawn: the app's defaults, overridden by the developer's menu choices.
      let settings = resolveSettings(defaultSettings, readStoredSettings(storage));

      // The latest findings, kept so a settings change redraws without a rescan,
      // and the latest findings per route visited, for the downloadable report.
      let lastFindings: A11yFinding[] = [];
      const visited = new Map<string, PageReport>();

      /** Draw (or clear) each overlay layer from the last scan and the settings. */
      function draw(): void {
        const shown = settings.highlights ? visibleFindings(lastFindings, settings.minImpact) : [];
        pillView?.setStatus({ found: lastFindings.length, shown: shown.length, pages: visited.size });
        if (!overlayView) return;
        if (!enabled) {
          overlayView.clear();
          overlayView.clearTabOrder();
          overlayView.renderAxPanel(null);
          return;
        }
        if (settings.highlights) overlayView.render(shown);
        else overlayView.clear();
        if (settings.tabOrder) {
          overlayView.renderTabOrder(tabSequence(root?.() ?? document, { frameworkPrefixes }));
        } else {
          overlayView.clearTabOrder();
        }
        if (!settings.focusPreview) overlayView.renderAxPanel(null);
      }

      const setEnabled = (next: boolean): void => {
        if (next === enabled) return;
        enabled = next;
        writeStoredEnabled(storage, enabled);
        pillView?.setEnabled(enabled);
        if (enabled) scanNow(); // don't wait for the app's next stable moment
        else draw();
      };

      const setSettings = (next: DevtoolsSettings): void => {
        settings = next;
        writeStoredSettings(storage, settings, defaultSettings);
        draw();
      };

      const downloadReport = (): void => {
        import('./report/html.js')
          .then(({ toHtml }) => {
            const html = toHtml({ generatedAt: new Date().toISOString(), pages: [...visited.values()] });
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `a11y-report-${new Date().toISOString().slice(0, 10)}.html`;
            link.setAttribute(OVERLAY_ATTR, '');
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
          .catch(() => undefined);
      };

      // The settings menu needs the overlay: without it there's nothing to show or hide.
      const pillView = pill
        ? createTogglePill({
            enabled,
            onToggle: setEnabled,
            shortcut,
            position: pill,
            menu: overlayView ? { settings, onChange: setSettings, onDownload: downloadReport } : undefined,
          })
        : undefined;

      let onKeyDown: ((event: KeyboardEvent) => void) | undefined;
      if (shortcut) {
        onKeyDown = (event: KeyboardEvent) => {
          if (!matchesShortcut(event, shortcut)) return;
          event.preventDefault();
          setEnabled(!enabled);
        };
        document.addEventListener('keydown', onKeyDown, true);
      }

      // Keyboard & Focus Mode, part C: a focus-follow accessibility-tree preview.
      // As the user Tabs, show the focused control's computed role/name/state —
      // the ~2/3 axe can't test — attributed to its component. Needs the visual
      // overlay; shown while the Focus preview setting is on.
      let onFocusIn: ((event: FocusEvent) => void) | undefined;
      if (overlayView) {
        onFocusIn = (event: FocusEvent) => {
          if (!enabled || !settings.focusPreview) return;
          const el = event.target;
          if (!(el instanceof Element) || el.closest(`[${OVERLAY_ATTR}]`)) return; // skip our own UI
          describeElement(el)
            .then((desc) => {
              if (!enabled || !settings.focusPreview) return; // switched off while describing
              overlayView.renderAxPanel({
                ...desc,
                component: resolveOwningComponentName(el, frameworkPrefixes),
                tag: el.tagName.toLowerCase(),
              });
            })
            .catch(() => undefined);
        };
        document.addEventListener('focusin', onFocusIn, true);
      }

      let scanning = false;
      function scanNow(): void {
        if (!enabled || scanning) return; // don't stack rescans while one is in flight
        scanning = true;
        runA11yScan(root?.(), { log, logger, axe, frameworkPrefixes, keyboard })
          .then((findings) => {
            if (!enabled) return; // switched off mid-scan: draw nothing
            lastFindings = findings;
            const route = location.pathname + location.search;
            // Label by route: a single-page app usually keeps one title on every route.
            visited.set(route, { label: route, url: location.href, findings });
            draw();
          })
          .catch(() => undefined)
          .finally(() => {
            scanning = false;
          });
      }

      const subscription = appRef.isStable
        .pipe(
          filter((stable) => stable),
          debounceTime(debounceMs),
        )
        .subscribe(scanNow);

      destroyRef.onDestroy(() => {
        subscription.unsubscribe();
        if (onFocusIn) document.removeEventListener('focusin', onFocusIn, true);
        if (onKeyDown) document.removeEventListener('keydown', onKeyDown, true);
        pillView?.destroy();
        overlayView?.destroy();
      });
    }),
  ]);
}

/** `window.localStorage`, or undefined where reading it throws (blocked storage). */
function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
