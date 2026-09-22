/**
 * Attribution core: given a DOM node that axe flagged, return the name of the
 * component responsible for it — the differentiator we haven't seen other axe
 * overlay devtools do (they report the DOM node, not the owning component by name).
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

/**
 * Third-party UI-primitive components (Nebular `Nb*`, Angular Material `Mat*`,
 * CDK `Cdk*`/`Mdc*`) whose violations are fixed where the primitive is *used*,
 * not inside the library — e.g. `<button nbButton>` with no name is fixed in the
 * component that placed it, not in Nebular. Attribution walks past these to the
 * app component. Matched with a CamelCase boundary so `MatchListComponent` isn't
 * mistaken for Material. A component library you author (e.g. `Ngbr*`) is
 * deliberately absent: a bug in a component you ship is fixed in that component.
 */
const PRIMITIVE_COMPONENT = /^(Nb|Mat|Cdk|Mdc)[A-Z]/;

function isPrimitiveComponent(name: string): boolean {
  return PRIMITIVE_COMPONENT.test(name);
}

/**
 * The chain of owning components from the flagged node up to the root, nearest
 * first and de-duplicated. Built by walking DOM ancestors and asking Angular's
 * debug API who owns each, so a control that is itself a library primitive still
 * reveals the app component that placed it. Empty when the global is absent (prod).
 */
export function resolveComponentPath(node: Element): string[] {
  const ng = ngDebug();
  // A production build can leave a partial `ng` global (present but without the
  // debug helpers). Treat a missing/!function owner-resolver as "no attribution"
  // rather than throwing mid-scan.
  if (!ng || typeof ng.getOwningComponent !== 'function') return [];
  const getComponent = typeof ng.getComponent === 'function' ? ng.getComponent.bind(ng) : null;
  const path: string[] = [];
  let el: Element | null = node;
  while (el) {
    let owner: unknown = null;
    try {
      owner = getComponent?.(el) ?? ng.getOwningComponent(el);
    } catch {
      owner = null; // node isn't part of a live view
    }
    const name = nameOf(owner);
    if (name && name !== path[path.length - 1]) path.push(name);
    el = el.parentElement;
  }
  return path;
}

/** The component to blame from an ownership path: the nearest one the app owns. */
export function appComponentFromPath(path: string[]): string | null {
  return path.find((name) => !isPrimitiveComponent(name)) ?? path[0] ?? null;
}

/**
 * The owning component name for a flagged node — the nearest component the app
 * author actually owns (walking past third-party UI primitives to where the fix
 * lives). Null when the debug global is absent (prod).
 */
export function resolveOwningComponentName(node: Element): string | null {
  return appComponentFromPath(resolveComponentPath(node));
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
