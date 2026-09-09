import {
  ApplicationRef,
  DestroyRef,
  type EnvironmentProviders,
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { debounceTime, filter } from 'rxjs';
import { runA11yScan } from './runner';
import type { Logger } from './report';
import { createOverlay } from './overlay';

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

  const { root, log = true, logger, overlay = false, debounceMs = 500 } = options;

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
          runA11yScan(root?.(), { log, logger })
            .then((findings) => overlayView?.render(findings))
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
