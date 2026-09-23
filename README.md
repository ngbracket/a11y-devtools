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
  tags: ['wcag22aa'],  // scope the ruleset; default = axe-core's full ruleset
  frameworkPrefixes: ['Nb', 'Mat', 'Cdk', 'Mdc'], // UI primitives to attribute past (default)
});
```

**Framework prefixes.** Attribution walks *past* third-party UI primitives to the app
component that placed them — a `<button nbButton>` with no name is blamed on your
`HeaderComponent`, not `NbButtonComponent`. The default list is `Nb`/`Mat`/`Cdk`/`Mdc`;
override `frameworkPrefixes` to add others (e.g. `['Nb','Mat','Nz','Clr','Ion']` — spread
`DEFAULT_FRAMEWORK_PREFIXES` to extend), or pass `[]` to attribute to the **immediate**
owner (useful when auditing a component library's *own* code). The same option is available
on `scan`, `runA11yScan`, `scanPages`, and the CLI (`--framework-prefixes` / `--no-skip-primitives`).

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

`scan()` and `runA11yScan()` also take full axe-core run options as a second
argument (`scan(root, { runOnly: … })`) for finer control than the provider's
`tags`.

## Report mode (headless, CI-friendly)

The provider is for while you're developing a page. **Report mode** turns the same
engine on a whole running app from the outside: it drives a headless browser over
your **dev** server, injects the same component-attributed scan, and writes a
report grouped by owning component — with no change to the app under test. It needs
a dev build, because that's what publishes `window.ng` for attribution; against a
production build, attribution falls back to `(unknown component)`.

Report mode is opt-in and needs Playwright, an **optional peer** you install
yourself (so the base package stays weightless):

```bash
npm i -D playwright
npx playwright install chromium
```

Start your app (`ng serve`), then point the CLI at it:

```bash
# writes a11y.md and a11y.json
npx ngbr-a11y-report --base http://localhost:4200 --route / --route /dashboard --out a11y

# CI gate: exit non-zero on any serious/critical finding
npx ngbr-a11y-report --base http://localhost:4200 --route / --fail-on serious
```

For apps gated behind a login or theme picker, use the programmatic API with a
`setup` hook (run once before the routes are scanned):

```ts
import { scanPages, toMarkdown } from '@ngbracket/a11y-devtools/report';

const report = await scanPages({
  baseUrl: 'http://localhost:4200',
  routes: ['/pages/dashboard'],
  setup: async (page) => {
    await page.goto('http://localhost:4200/login');
    await page.fill('#email', 'demo@example.com');
    await page.click('button[type=submit]');
  },
});
console.log(toMarkdown(report));
```

The report leads with a summary of **distinct rules vs. raw node-instances** (a
"54" is usually one rule firing dozens of times), then lists findings under each
owning component. When a flagged control is itself a third-party UI primitive
(e.g. `<button nbButton>`), attribution walks past the primitive to the app
component that placed it and notes the primitive as `(via …)`.

## What it checks (and what it can't)

Under the hood this is [axe-core](https://github.com/dequelabs/axe-core) — the
scan runs axe's rules and enriches each violation with the owning component. By
default it runs axe-core's full ruleset: the **machine-testable** rules across
**WCAG 2.0, 2.1 and 2.2, Levels A & AA**, plus axe's *best-practice* rules. Scope
it to a single conformance target with `tags` (e.g. `['wcag22aa']`) or
`['wcag21aa', 'best-practice']`.

Automated checks only cover the part of WCAG a machine can test — on the order of
a third of the success criteria. Many WCAG 2.2 additions have **no automated rule
at all** (target size 2.5.8, dragging 2.5.7, consistent help, redundant entry,
accessible authentication), so a clean run is necessary, not sufficient — the rest
needs keyboard, screen-reader and human testing. (WCAG 3.0 is still an early W3C
draft with a different, non-final model; there's nothing to test against yet.)

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

- Configurable framework-primitive prefixes (PrimeNG, Clarity, Ionic, …).
- HTML report + baseline/diff mode for CI.
- Per-component filtering and a violation-count badge.

Done: component attribution (nearest app-owned, walking past UI primitives) ·
directive / `hostDirectives` attribution · axe scan · grouped console reporter ·
dev-only provider · in-app overlay · headless report mode (CLI + `./report`) ·
CI prod-weight guard.
