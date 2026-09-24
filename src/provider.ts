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
import { createOverlay } from './overlay.js';
import { tabSequence } from './keyboard/tab-sequence.js';

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
  } = options;
  const axe: AxeRunOptions | undefined = tags
    ? { runOnly: { type: 'tag', values: tags } }
    : undefined;

  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const appRef = inject(ApplicationRef);
      const destroyRef = inject(DestroyRef);

      const overlayView = overlay ? createOverlay() : undefined;

      let scanning = false;
      const subscription = appRef.isStable
        .pipe(
          filter((stable) => stable),
          debounceTime(debounceMs),
        )
        .subscribe(() => {
          if (scanning) return; // don't stack rescans while one is in flight
          scanning = true;
          runA11yScan(root?.(), { log, logger, axe, frameworkPrefixes, keyboard })
            .then((findings) => {
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
        });

      destroyRef.onDestroy(() => {
        subscription.unsubscribe();
        overlayView?.destroy();
      });
    }),
  ]);
}
