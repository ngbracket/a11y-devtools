# @ngbracket/a11y-devtools

Accessibility checks for Angular apps that name the component behind each problem.
It runs axe-core on your app, as an overlay while you develop or headless in CI,
and groups what it finds by the component that rendered it:

```text
♿ UserCardComponent — 2 issue(s)
    critical · image-alt: Images must have alternative text
    serious · color-contrast: Elements must meet minimum color contrast ratio thresholds
```

Documentation: [ngbracket.com/tools/a11y-devtools/docs](https://ngbracket.com/tools/a11y-devtools/docs/introduction)
has the guides, every option and CLI flag, and the rule catalogue. You can also try the
[live demo](https://a11y-demo.ngbracket.com/a11y-demo) without installing anything.

Part of the `@ngbracket` Angular tooling family.

## Features

| Feature | What it does |
|---|---|
| Component attribution | Names the Angular component to fix for every finding, skipping past UI-library components (Material, CDK, Nebular and others) to yours. Uses Angular's documented dev debug API (`window.ng`). |
| In-app provider | Rescans each time the app settles, logs findings grouped by component, and can draw an overlay on the page. Turn it on and off with the on-page pill or Alt+Shift+A. The pill's menu picks what's drawn (highlights, tab order, Focus preview, minimum severity) and downloads an HTML report of the routes you've visited. Your choices are remembered. |
| Report mode | Scans many routes headless from the CLI and writes Markdown, JSON and a self-contained HTML report. |
| CI gating with a baseline | Fails only on new issues, so an app with known issues can add the gate straight away. |
| Dark mode | Scans your dark theme too, whether it follows the OS setting, a class, an attribute or your own logic. |
| Keyboard & Focus Mode | Numbers the tab order, adds keyboard findings, shows the Focus preview card (computed role, name and state), and finds keyboard traps by pressing Tab for real. |
| Production weight | Does nothing in production builds, and axe-core isn't loaded there. |

## Install

```bash
npm i -D @ngbracket/a11y-devtools

# for report mode only
npm i -D playwright && npx playwright install chromium
```

It needs Angular 18 or later.

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
keyboard findings), and the Focus preview card showing the focused button's
computed role, name and states.](./demo/keyboard-layer-2026-09.png)

In CI (`--serve` starts `ng serve`, waits for it, and stops it after the scan):

```bash
npx ngbr-a11y-report --serve "npx ng serve" --route / --route /settings \
  --keyboard --baseline a11y-baseline.json --fail-on serious --out a11y --format all
```

Preparing a VPAT/ACR? `--format acr` adds an evaluation worksheet: the results by WCAG 2.2
A/AA criterion, with the conformance columns left for a person to fill in. Already scanned?
`--from a11y.json --out a11y --format acr` writes it from the saved JSON report.

Next steps, in the docs:
[Your first scan](https://ngbracket.com/tools/a11y-devtools/docs/first-scan) ·
[Report mode](https://ngbracket.com/tools/a11y-devtools/docs/report-mode) ·
[CI gating with a baseline](https://ngbracket.com/tools/a11y-devtools/docs/ci-baseline) ·
[ACR worksheet](https://ngbracket.com/tools/a11y-devtools/docs/acr-worksheet) ·
[CLI reference](https://ngbracket.com/tools/a11y-devtools/docs/cli) ·
[Findings & rules](https://ngbracket.com/tools/a11y-devtools/docs/findings)

## What it leaves to you

Automated checks cover part of WCAG. Keyboard, screen-reader and human testing cover
the rest, so a clean run still needs those. The keyboard findings are heuristics,
each labelled "verify manually". The tool helps you build toward supporting WCAG 2.2
AA; it doesn't certify conformance. See
[What it checks](https://ngbracket.com/tools/a11y-devtools/docs/coverage).

## Develop

```bash
npm install --legacy-peer-deps
npm run build   # tsc -> dist/ (ESM + .d.ts) + the in-page bundle
npm test        # vitest + jsdom + Angular TestBed (real axe); the real-browser
                # E2E specs run after a build, once `npx playwright install chromium`
```

The real-browser specs are `src/testing/e2e-report.spec.ts` (report mode against plain-HTML
pages) and `src/testing/e2e-angular.spec.ts` (component attribution against a real Angular
app). The second builds the fixture app in `e2e/angular-app` itself, with `@angular/build`
(no Angular CLI needed). To build it by hand, for example to open it in a browser:

```bash
node scripts/build-angular-fixture.mjs   # → e2e/angular-app/dist/{dev,prod}/browser
```

CI also runs a production-weight guard: a bundle-graph test that fails if axe-core
ever becomes reachable through a static import.

## Roadmap

### Planned

- A headless "linear walkthrough": the tab sequence as a reading list per route in
  report mode. The Focus preview is overlay-only for now.
- Per-component filtering and a violation-count badge.

### Done

- Component attribution: the nearest app-owned component, skipping UI primitives.
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
- Keyboard & Focus Mode M1: tab-order visualisation and keyboard-reachability findings.
- Keyboard & Focus Mode M2: the focus-follow accessibility-tree preview (now called Focus preview).
- Keyboard & Focus Mode M3: missing focus-trap detection (an `aria-modal` that doesn't
  contain focus) and the keyboard-trap walk with real Tab presses.
- CI production-weight guard.
- Real-browser E2E tests, including component attribution in a real Angular app.
- Report mode can start the dev server (`--serve`).
- ACR evaluation worksheet by WCAG 2.2 A/AA criterion (`--format acr`).
- Re-render a saved JSON report in any format without scanning (`--from`).
