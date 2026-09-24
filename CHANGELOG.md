# Changelog

All notable changes to `@ngbracket/a11y-devtools` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 0.7.2

### Fixed

- **Findings labels no longer cover each other.** Where several flagged nodes
  cluster (or share a column), each finding's label was drawn at its box's
  top-left corner, so the labels piled on the same spot and the later one hid the
  earlier — e.g. a `color-contrast` label sitting behind a `region` label. The
  overlay now runs a de-collision pass (`resolveLabelStack`) that walks labels
  top-to-bottom and lifts each one until it clears the labels already placed, so
  every finding stays readable. Runs on render and on scroll/resize.

## 0.7.1

### Fixed

- **Tab-order badges no longer collide with the findings labels.** A numbered
  tab-order badge was anchored on each control's top-left corner — exactly where
  the severity-coloured finding labels sit — so on a flagged control the two
  overlapped and obscured each other. Badges now sit just outside the control's
  left edge, vertically centred (clamped into the viewport for controls flush to
  the left), and the connector path threads those points.

## 0.7.0

### Added

- **Keyboard & Focus Mode — M2: the accessibility-tree preview.** With
  `keyboard: true` **and** `overlay: true`, a panel now follows focus: as you Tab,
  it shows the focused control's computed **role, accessible name, description, and
  ARIA states**, attributed to the owning component.
  - Name and role are computed by **axe-core's own accname commons** (one accname
    source, not a second home-grown one). axe stays behind a dynamic import, so the
    prod-weight guarantee is unchanged.
  - **Honesty guardrail:** the panel is headed *"Accessibility-tree preview —
    computed approximation"* and never branded as any specific screen reader's
    output. A missing accessible name is flagged in warning colour.
  - New public API: `describeElement` (async, axe-backed), `accessibleDescription`,
    `ariaStates`, and the `AxDescription` / `AxPanelData` types; the overlay gains
    `renderAxPanel`.

## 0.6.0

### Added

- **Keyboard & Focus Mode — M1: the keyboard layer.** The first checks for the
  ~2/3 of accessibility axe can't test — keyboard operability — attributed to the
  owning component like everything else. Opt in with `keyboard: true` (provider /
  `runA11yScan` / `scan` / `scanPages`) or `--keyboard` on the CLI.
  - **Tab-order visualisation** (overlay): numbered badges at each tab stop plus a
    connector path showing the order focus actually moves; a positive-`tabindex`
    stop is flagged as a warning because it hijacks the natural order.
  - **Keyboard findings** (`ngbr/*` rule ids, grouped and reported like axe
    violations):
    - `ngbr/unreachable-control` (serious) — an interactive element (ARIA role or a
      runtime `click` listener) that isn't a native control and has no
      `tabindex >= 0`, so it can't be reached by keyboard.
    - `ngbr/click-without-key` (moderate, heuristic) — a focusable element with a
      `(click)` handler but no keyboard handler, so Enter/Space may not activate it.
      Read from `window.ng.getListeners`, a **runtime** signal a static template
      lint can't see (e.g. a listener added via `hostDirectives`).
    - `ngbr/tab-order-mismatch` (moderate, heuristic) — the tab path jumps against
      the visual reading order. Needs real layout (report-mode / a real browser).
  - New public API: `tabSequence`, `scanKeyboard`, `isTabbable`,
    `isNativelyFocusable`, `resolvedTabIndex`, `visualOrderJumps`,
    `resolveListenerEvents`, and the `TabStop` / `NgListener` types.
  - **Honesty guardrail:** the heuristic findings are labelled "verify manually",
    never reported as confirmed failures.

## 0.5.0

### Added

- **Configurable framework prefixes.** The component-name prefixes attribution
  walks past (third-party UI primitives) are now configurable instead of a
  hardcoded `Nb`/`Mat`/`Cdk`/`Mdc` list:
  - `provideA11yDevtools({ frameworkPrefixes })`, `runA11yScan(root, { frameworkPrefixes })`,
    `scan(root, axe, { frameworkPrefixes })`, and `scanPages({ frameworkPrefixes })`.
  - CLI: `--framework-prefixes Nb,Mat,Nz,Clr,Ion` and `--no-skip-primitives`.
  - Pass `[]` (or `--no-skip-primitives`) to attribute to the **immediate** owner —
    e.g. when scanning a component library's *own* code, so it blames the library
    component rather than a demo wrapper.
  - Exported `DEFAULT_FRAMEWORK_PREFIXES` (spread it to extend: `[...DEFAULT_FRAMEWORK_PREFIXES, 'Nz']`)
    and the `ScanOptions` type.

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
