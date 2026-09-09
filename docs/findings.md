# Item 5 — Angular a11y devtools (the flagship): research findings

Status: **viable, the most defensible item so far — MVP shipped.** The headline differentiator is a *documented public Angular API*, not a fragile hack. Validated Sep 2026.

Target package: **`@ngbracket/a11y-devtools`** (see [family naming](item-2-a11y-lint-findings.md)). Public OSS under the ngbracket brand. Completes the accessibility cluster (items 2 lint + 3 testing + 5 runtime).

**MVP promoted (Sep 2026):** package built at `ngbracket-a11y-devtools/` — attribution + axe scan (enriched with component names) + grouped console reporter + dev-only `provideA11yDevtools()` (zoneless-aware rescan via `ApplicationRef.isStable`). 9 tests green. Scans are serialized (axe is a singleton — concurrent runs throw). The visual overlay + `host`/`hostDirectives` runtime a11y are roadmap.

---

## The flagship differentiator is confirmed feasible

The doc's key claim — map each axe violation back to the component that rendered it — rests on Angular's debug globals. Research sharpens it:

- **`getOwningComponent(node)`** is a *documented public Angular global*: "retrieves the component instance whose view contains the DOM element." Given an arbitrary offending node from an axe violation, it returns the owning component. This is the right primitive for the *inner* nodes axe actually flags.
- **`getComponent(node)`** only works on a component's **host** element — use it first (for the host-element case), then fall back to `getOwningComponent`.
- Both are importable from `@angular/core` (same functions published to `window.ng` in dev).

These work **only in dev mode** (Angular strips debug data in prod) — perfect alignment, not a limitation: the tool is dev-only by nature, and component names are readable (un-minified) in dev builds.

## The competitive gap is real

- **React has three overlay tools, none doing automatic component attribution:** `@axe-core/react` (console, dedupes by **CSS selector**; deprecated, no React 18+), `axe-mode` (overlay, Ctrl+I), and the current leader **TanStack Devtools a11y plugin** (impact-colored overlays, click-to-navigate — but "component-level scanning" = *manual per-component hooks*, not automatic attribution).
- **Angular has nothing equivalent** for modern (post-AngularJS) apps — only axe *testing* integrations and Deque's browser extension exist.

React tools *structurally can't* match automatic node→component attribution (React's fiber traversal is internal/unstable; Angular's `getOwningComponent` is public and documented). **The moat is stronger than the doc frames it.**

## Corrections / additions to the original idea doc

1. **Primitive precision:** use `getOwningComponent` for flagged inner nodes; `getComponent` only for host elements. The doc said "`ng.getComponent()` / DebugNode traversal" — `getOwningComponent` is the correct, simpler tool.
2. **Zero-prod-weight needs a specific mechanism:** `provideA11yDevtools()` must guard behind `ngDevMode`/`isDevMode()` **and dynamic-import axe-core** (`await import('axe-core')`, ~550 KB) so a prod build tree-shakes it out — and that absence should be **proven by a CI bundle-size check**, or nobody trusts it.
3. **Zoneless rescan triggering is unaddressed by the doc.** With v21 zoneless there are no zone hooks to know when to re-scan; drive rescans via `afterRender`/`ApplicationRef` stability or a `MutationObserver`. Real design work, feasible.

## Bonus: item 5 absorbs what item 2 had to cut

The `host`/`hostDirectives` awareness cut from the lint plugin (unreachable statically) *is* reachable here — at runtime `getOwningComponent` + `getDirectives(element)` expose it. Lint catches static cases; devtools catches runtime/host cases. This ties the cluster together.

## Shape (MVP → flagship)

1. `resolveOwningComponentName(node)` — the attribution core (spike target).
2. axe-core scan on a running app, each violation enriched with its owning component name.
3. Grouped console output with the component name as the group label.
4. In-app overlay: severity-colored highlights, click-to-scroll, excludes its own root from scanning.
5. `provideA11yDevtools()` dev-only provider; dynamic-import axe; zoneless-aware rescan.

## Spike result (attribution core) — proven

`spikes/a11y-component-attribution/` — **3/3 green.** A real `axe.run()` flags an
`<img>` with no alt in a child `UserCardComponent`; taking the node exactly as axe
reports it, `resolveOwningComponentName(node)` returns `'UserCardComponent'`. Real
axe engine + real Angular runtime, in jsdom.

**Implementation correction (important):** the debug helpers are **not** public
named exports of `@angular/core` — importing `{ getComponent, getOwningComponent }`
throws `getComponent is not a function`. They are methods on the **`window.ng`
global** published by `publishDefaultGlobalUtils` in dev mode. Access via
`globalThis.ng`; its absence is the non-dev signal, so the tool should no-op there
(dead-on for the dev-only design). `window.ng` is published under TestBed once a
component is created, so attribution is unit-testable in jsdom.

## Feasibility risks (ranked)

- **Low:** node→component attribution (documented API — see spike).
- **Medium:** zero-prod-weight elimination (dynamic import + guard; provable via CI).
- **Medium:** zoneless rescan cadence (design, not a blocker).
- **Low/known:** overlay excluding itself; colour-contrast needs real rendering (runs in the actual browser here, so it's available — unlike the jsdom test harness).

## Sources

- getOwningComponent: https://angular.dev/api/core/globals/getOwningComponent
- getComponent: https://angular.dev/api/core/globals/getComponent
- TanStack Devtools a11y plugin: https://tanstack.com/devtools/latest/docs/plugins/a11y
- axe-mode: https://github.com/raunofreiberg/axe-mode
- @axe-core/react: https://www.npmjs.com/package/@axe-core/react
