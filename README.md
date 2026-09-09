# @ngbracket/a11y-devtools

Dev-only, in-app accessibility auditing for Angular that maps each axe violation
back to **the component that rendered it** — the attribution React overlay tools
(`@axe-core/react`, `axe-mode`, TanStack a11y) structurally can't do.

Report `♿ UserCardComponent — 2 issue(s)` instead of a wall of CSS selectors.

Part of the `@ngbracket` Angular tooling family. See
`../content/tooling/item-5-devtools-findings.md` for the research and scope.

## Status

MVP. Ships attribution + axe scan + grouped console reporter + the dev-only
provider. The visual in-app overlay is on the roadmap.

## How the attribution works

Angular publishes debug helpers on the `window.ng` global in dev mode.
`getOwningComponent(node)` returns the component whose view contains a DOM node,
so any axe-flagged element resolves to its owning component. These helpers exist
**only in dev builds** — which is exactly right: the tool is dev-only, and the
global's absence in prod is the signal to no-op.

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
  debounceMs: 500,     // quiet window after stabilization before scanning
});
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
fetches. For a hard guarantee that it's absent entirely, include the provider only
in your dev bootstrap config — and verify with a bundle check in CI.

## Develop

```bash
npm install --legacy-peer-deps
npm test        # vitest + jsdom + Angular TestBed (real axe)
npm run build   # tsc -> dist/ (ESM + .d.ts)
```

## Roadmap

- **In-app overlay:** severity-colored highlights, click-to-scroll, excludes its
  own root from scanning.
- **`host` / `hostDirectives` a11y** via `getDirectives(el)` — the runtime cases
  the item-2 lint plugin can't see statically.
- Per-component filtering and a violation count badge.
- CI bundle-size assertion proving axe-core is absent from prod builds.
