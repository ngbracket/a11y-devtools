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
  getDirectives(element: Element | object): unknown[];
}

export function ngDebug(): NgDebugGlobal | undefined {
  return (globalThis as { ng?: NgDebugGlobal }).ng;
}

/**
 * Angular's dev output can emit class names with a leading underscore
 * (e.g. `_Login` for `Login`); strip it so attribution shows the authored name.
 */
function cleanName(name: string | null): string | null {
  if (!name) return null;
  return name.replace(/^_+/, '') || null;
}

function nameOf(instance: unknown): string | null {
  if (!instance || typeof instance !== 'object') return null;
  return cleanName((instance.constructor as { name?: string }).name ?? null);
}

export function resolveOwningComponentName(node: Element): string | null {
  const ng = ngDebug();
  if (!ng) return null;
  const component = ng.getComponent(node) ?? ng.getOwningComponent(node);
  return nameOf(component);
}

/**
 * Names of the directives applied directly to `node`, including those attached
 * via `hostDirectives` — the runtime-only a11y cases the static lint plugin
 * can't see. Empty when the debug global is absent or the node has none.
 */
export function resolveDirectiveNames(node: Element): string[] {
  const ng = ngDebug();
  if (!ng?.getDirectives) return [];
  let directives: unknown[];
  try {
    directives = ng.getDirectives(node) ?? [];
  } catch {
    return []; // node isn't part of a live view
  }
  const names: string[] = [];
  for (const directive of directives) {
    const name = nameOf(directive);
    if (name) names.push(name);
  }
  return names;
}
