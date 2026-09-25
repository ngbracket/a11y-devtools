# @ngbracket/a11y-devtools

Accessibility auditing for Angular that maps each axe violation back to **the
component that rendered it**, so you get `♿ UserCardComponent — 2 issue(s)`, not a
wall of CSS selectors. Run it as a dev overlay while you build, or headless in CI.

**📖 Documentation: [ngbracket.com/tools/a11y-devtools/docs](https://ngbracket.com/tools/a11y-devtools/docs/introduction)**
(guides, every option and CLI flag, and the rule catalogue).

Part of the `@ngbracket` Angular tooling family.

## Features

- **Component attribution**: every finding names the Angular component to fix,
  walking past UI-library components (Material, CDK, Nebular, …) to yours. Uses
  Angular's documented dev debug API (`window.ng`).
- **In-app provider**: rescans as the app settles; grouped console output and an
  optional on-page overlay. Switch it on and off with the on-page pill or
  Alt+Shift+A; the pill's menu picks what's drawn (highlights, tab order, focus
  preview, minimum severity) and downloads an HTML report of the routes you've
  visited. Choices are remembered.
- **Report mode**: scan many routes headless from the CLI; Markdown, JSON and a
  self-contained HTML report.
- **CI gating with a baseline**: fail only on *new* issues, so an app with known
  issues can adopt the gate today.
- **Dark mode**: scan your dark theme too, whether it follows the OS setting, a
  class, an attribute, or custom logic.
- **Keyboard & Focus Mode**: tab-order visualisation, keyboard findings,
  accessibility-tree preview, and keyboard-trap detection with real Tab presses.
- **Zero production weight**: a no-op in production; axe-core is never loaded.

## Install

```bash
npm i -D @ngbracket/a11y-devtools

# for report mode only
npm i -D playwright && npx playwright install chromium
```

Needs Angular 18+.

## Quick start

While you build:

```ts
// app.config.ts
import { provideA11yDevtools } from '@ngbracket/a11y-devtools';

export const appConfig: ApplicationConfig = {
  providers: [provideA11yDevtools({ overlay: true, keyboard: true })],
};
```

![Keyboard & Focus Mode over the demo page: numbered tab-order badges (badge 1 in
orange flags a positive tabindex) joined by a connector path, severity-coloured
finding highlights labelled with their owning component (including the ngbr/*
keyboard findings), and the focus-follow accessibility-tree panel showing the
focused button's computed role, name and states.](./demo/keyboard-layer-2026-09.png)

In CI, against a running `ng serve`:

```bash
npx ngbr-a11y-report --base http://localhost:4200 --route / --route /settings \
  --keyboard --baseline a11y-baseline.json --fail-on serious --out a11y --format all
```

Next steps, in the docs:
[Your first scan](https://ngbracket.com/tools/a11y-devtools/docs/first-scan) ·
[Report mode](https://ngbracket.com/tools/a11y-devtools/docs/report-mode) ·
[CI gating with a baseline](https://ngbracket.com/tools/a11y-devtools/docs/ci-baseline) ·
[CLI reference](https://ngbracket.com/tools/a11y-devtools/docs/cli) ·
[Findings & rules](https://ngbracket.com/tools/a11y-devtools/docs/findings)

## What it can't do

Automated checks cover part of WCAG, so a clean run is necessary, not sufficient:
keyboard, screen-reader and human testing cover the rest. The keyboard findings are
heuristics, labelled "verify manually". It helps you build toward supporting WCAG
2.2 AA; it doesn't certify conformance. See
[What it checks (and what it can't)](https://ngbracket.com/tools/a11y-devtools/docs/coverage).

## Develop

```bash
npm install --legacy-peer-deps
npm run build   # tsc -> dist/ (ESM + .d.ts) + the in-page bundle
npm test        # vitest + jsdom + Angular TestBed (real axe); the real-browser
                # E2E spec runs after a build, once `npx playwright install chromium`
```

CI also runs a production-weight guard: a bundle-graph test that fails if axe-core
ever becomes reachable through a static import.

## Roadmap

### Planned

- Headless "linear walkthrough" — the tab sequence as an SR-ish reading list per
  route in report-mode (M2's preview is currently overlay-only).
- Per-component filtering and a violation-count badge.

### Done

- Component attribution — the nearest app-owned component, walking past UI primitives.
- Directive and `hostDirectives` attribution.
- Configurable framework prefixes.
- axe scan.
- Grouped console reporter.
- Dev-only provider.
- In-app overlay.
- Headless report mode (CLI + `./report`).
- HTML report output.
- Baseline/diff mode: CI fails only on new issues.
- Dark-mode scanning: `--color-scheme`, `--dark-class` / `--dark-attribute`, and theme-aware hooks.
- **Keyboard & Focus Mode M1** — tab-order visualisation + keyboard-reachability findings.
- **Keyboard & Focus Mode M2** — focus-follow accessibility-tree preview.
- **Keyboard & Focus Mode M3** — missing focus-trap detection (uncontained
  `aria-modal`) and the keyboard-trap walk with real Tab presses.
- CI production-weight guard.
- Real-browser E2E test.
