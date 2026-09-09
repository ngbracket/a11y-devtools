/**
 * Attribution core: given a DOM node that axe flagged, return the name of the
 * component responsible for it — the differentiator React overlay tools can't do.
 *
 * Angular's debug helpers are NOT public named exports of `@angular/core`; they
 * are methods on the `window.ng` global published in dev mode
 * (`publishDefaultGlobalUtils`). `getComponent` resolves a component's host
 * element to its instance; `getOwningComponent` resolves any inner node to the
 * component whose view contains it. Try host first, then owner. The global's
 * absence is the non-dev signal — callers should treat `null` as "not available".
 */
export interface NgDebugGlobal {
  getComponent(element: Element): unknown;
  getOwningComponent(element: Element | object): unknown;
}

export function ngDebug(): NgDebugGlobal | undefined {
  return (globalThis as { ng?: NgDebugGlobal }).ng;
}

function nameOf(instance: unknown): string | null {
  if (!instance || typeof instance !== 'object') return null;
  return (instance.constructor as { name?: string }).name ?? null;
}

export function resolveOwningComponentName(node: Element): string | null {
  const ng = ngDebug();
  if (!ng) return null;
  const component = ng.getComponent(node) ?? ng.getOwningComponent(node);
  return nameOf(component);
}
