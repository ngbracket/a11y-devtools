# Changelog

All notable changes to `@ngbracket/a11y-devtools` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 0.4.0

### Added

- **Report mode** — a headless, CI-friendly way to scan a whole running app. A new
  `./report` export (`scanPages`, `toMarkdown`, `toJson`) and a `ngbr-a11y-report`
  CLI drive a headless browser over your dev server, inject the same
  component-attributed scan, and write a Markdown + JSON report grouped by owning
  component. No change to the app under test.
  - `--fail-on <impact>` exits non-zero on findings at/above a severity, for CI gates.
  - A `setup` hook (programmatic API) handles apps gated behind a login or theme picker.
  - Reports surface **distinct rules vs. raw node-instances**.
- `A11yFinding.componentPath` — the full ownership chain from the flagged node to
  the root, nearest first.
- Exported `resolveComponentPath` and `appComponentFromPath`.

### Changed

- **Attribution now reports the nearest _app-owned_ component.** Violations on a
  third-party UI primitive (Nebular `Nb*`, Angular Material `Mat*`, CDK
  `Cdk*`/`Mdc*`) are attributed to the app component that placed them — where the
  fix lives — instead of the library component. A component library you author
  (`Ngbr*`) is intentionally not skipped. This changes `finding.component` (and the
  console/overlay grouping) for such cases; the primitive is preserved in
  `componentPath` and shown as `(via …)` in the report.

### Packaging

- Playwright is an **optional peer dependency** (not auto-installed) — install it
  only if you use report mode. The base package stays weightless; axe-core still
  never reaches your app bundle (enforced by the prod-weight guard, now extended to
  keep report-mode code out of the browser entry).

## 0.3.0

- Scoped ruleset via `tags`; documented WCAG coverage.
- Component + directive/`hostDirectives` attribution, axe scan, grouped console
  reporter, dev-only provider, in-app overlay, CI prod-weight guard.
