# @ngbracket/a11y-devtools

Dev-only, in-app accessibility auditing for Angular that maps each axe violation
back to **the component that rendered it** — so you get
`♿ UserCardComponent — 2 issue(s)`, not a wall of CSS selectors.

The axe-based devtools in this space — [`@axe-core/react`](https://www.npmjs.com/package/@axe-core/react),
[`axe-mode`](https://github.com/raunofreiberg/axe-mode), and
[TanStack's a11y plugin](https://tanstack.com/devtools/latest/docs/plugins/a11y)
(now cross-framework, with an Angular adapter too) — report the DOM node (selector,
HTML, rule id) and highlight it, but we haven't seen one tie a violation back to the
component that rendered it, by name. This does, through Angular's **documented** dev
debug API (`window.ng`) rather than private framework internals.

Part of the `@ngbracket` Angular tooling family.

## Status

Ships attribution — component **and** directive-level — + axe scan + grouped
console reporter (with a summary line) + the dev-only provider + the visual in-app
overlay (severity-coloured highlights, click-to-scroll).

## How the attribution works

Angular publishes debug helpers on the `window.ng` global in dev mode.
`getOwningComponent(node)` returns the component whose view contains a DOM node,
so any axe-flagged element resolves to its owning component; `getDirectives(node)`
adds the directives applied to that node — including those pulled in via
`hostDirectives` — which are the runtime cases a static ESLint pass can't see.
These helpers exist **only in dev builds** — which is exactly right: the tool is
dev-only, and the global's absence in prod is the signal to no-op.

## Install

```bash
npm i -D @ngbracket/a11y-devtools
```

Peer deps: `@angular/core >=18`, `rxjs >=7`.

## Usage

```ts
// app.config.ts (dev configuration)
import { provideA11yDevtools } from '@ngbracket/a11y-devtools';

export const appConfig = {
  providers: [
    // ...your providers
    provideA11yDevtools(),
  ],
};
```

It rescans whenever the app settles (zoneless-aware, via `ApplicationRef.isStable`)
and logs violations grouped by owning component. Options:

```ts
provideA11yDevtools({
  root: () => document.querySelector('main')!, // scan scope; default document
  log: true,           // grouped console output; default true
  overlay: true,       // in-app visual highlights over flagged nodes; default false
  debounceMs: 500,     // quiet window after stabilization before scanning
});
```

Findings are grouped by owning component, led by a summary line, and each node's
directives are shown inline:

```text
♿ a11y-devtools: 2 issue(s) across 1 component(s)
♿ UserCardComponent — 2 issue(s)
    critical · image-alt: Images must have alternative text [via TooltipDirective]
      img
      https://dequeuniversity.com/rules/axe/4.13/image-alt
    serious · color-contrast: Elements must meet minimum contrast
      button.save
      https://dequeuniversity.com/rules/axe/4.13/color-contrast
```

You can also scan on demand:

```ts
import { runA11yScan, scan } from '@ngbracket/a11y-devtools';

const findings = await runA11yScan();      // scan + grouped log
const raw = await scan(document.body);     // findings only
```

## Production weight

In production `provideA11yDevtools()` is a **no-op** and axe-core is never loaded.
axe-core is a **dynamic import**, so it lands in a lazy chunk that prod never
fetches, and the package is `sideEffects: false` so an unused import tree-shakes
away entirely. For a hard guarantee, include the provider only in your dev
bootstrap config (e.g. behind `isDevMode()`).

This is **enforced in CI**: `src/testing/prod-weight.spec.ts` bundles the entry
with esbuild and walks the module graph — axe-core must be reachable *only*
through a dynamic import, never a static one. Turning `import('axe-core')` into a
static import (or adding a top-level side effect) fails the build.

## Develop

```bash
npm install --legacy-peer-deps
npm test        # vitest + jsdom + Angular TestBed (real axe)
npm run build   # tsc -> dist/ (ESM + .d.ts)
```

## Roadmap

- Per-component filtering and a violation-count badge.

Done: component attribution · directive / `hostDirectives` attribution · axe scan ·
grouped console reporter · dev-only provider · in-app overlay · CI prod-weight guard.
