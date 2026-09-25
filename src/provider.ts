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
  } = options;
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

      const setEnabled = (next: boolean): void => {
        if (next === enabled) return;
        enabled = next;
        writeStoredEnabled(storage, enabled);
        pillView?.setEnabled(enabled);
        if (enabled) {
          scanNow(); // don't wait for the app's next stable moment
        } else {
          overlayView?.clear();
          overlayView?.clearTabOrder();
          overlayView?.renderAxPanel(null);
        }
      };

      const pillView = pill
        ? createTogglePill({ enabled, onToggle: setEnabled, shortcut, position: pill })
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
      // the ~2/3 axe can't test — attributed to its component. Only meaningful
      // with the visual overlay on.
      let onFocusIn: ((event: FocusEvent) => void) | undefined;
      if (overlayView && keyboard) {
        onFocusIn = (event: FocusEvent) => {
          if (!enabled) return;
          const el = event.target;
          if (!(el instanceof Element) || el.closest(`[${OVERLAY_ATTR}]`)) return; // skip our own UI
          describeElement(el)
            .then((desc) => {
              if (!enabled) return; // switched off while describing
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
            overlayView?.render(findings);
            // Draw the tab-order path as its own overlay layer (independent of
            // the findings highlights) when the keyboard layer is on.
            if (overlayView && keyboard) {
              overlayView.renderTabOrder(
                tabSequence(root?.() ?? document, { frameworkPrefixes }),
              );
            }
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
