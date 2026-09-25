# Changelog

All notable changes to `@ngbracket/a11y-devtools` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 0.12.0

### Added

- **A settings menu on the pill.** The `⋯` button next to the on/off switch opens a
  panel for choosing what's drawn, so you're not looking at everything at once:
  - **Highlights**, **Tab order** and **Focus preview**, each on or off.
  - **Show issues**: all, moderate and above, serious and above, or critical
    only. It filters what's drawn on the page; the console still logs every issue.
  - How many issues the page has and how many are shown.
  - **Download report**: a self-contained HTML report (the same format as report
    mode) for every route you've visited since the app loaded, labelled by route.
  Each developer's choices are remembered in `localStorage`; only what differs
  from the app's defaults is stored. Needs `overlay: true`.
- New provider options set the defaults: `layers` (`{ highlights, tabOrder,
  focusPreview }`) and `minImpact`. `highlights` defaults to `true`; `tabOrder`
  and `focusPreview` follow `keyboard`, as before. Tab order and focus preview can
  now also be turned on from the menu without `keyboard: true`, which still
  controls the `ngbr/*` keyboard findings.

### Fixed

- **The overlay and the on/off pill now show over modals.** Native
  `<dialog>.showModal()` and popovers render in the browser's top layer, above
  any z-index, and Angular CDK overlays use popovers by default from v22, so that
  covers Material dialogs, menus and selects. The overlay was drawn underneath
  them, and a modal `<dialog>` also made the pill unclickable. The overlay and the
  pill are now top-layer popovers too: while a modal dialog is open they move
  inside it, and they re-show whenever the app opens another popover so they stay
  on top.
- **No false `ngbr/modal-focus-not-contained` on Angular CDK / Material
  dialogs.** CDK keeps focus in with a JS focus trap (empty `aria-hidden`
  sentinels either side of the dialog) rather than making the page inert. A modal
  bracketed by sentinels (`aria-hidden="true"` or `data-focus-guard`, with no
  content) now counts as containing focus. Checked with real Tab presses on a CDK
  dialog. A modal with no trap is still flagged.
- **The tab order while a modal is open** only includes the modal's own stops,
  for native modal dialogs and for trapped `aria-modal` dialogs. That removes
  false `ngbr/tab-order-mismatch` findings and tab-order badges on the page behind
  the modal. Focus-trap sentinels are left out of the tab order. Pass
  `includeSentinels: true` to `tabSequence` to keep them.

## 0.11.0

### Added

- **Turn the devtools on and off without changing code.** An on/off pill sits in
  the bottom-left corner, and **Alt+Shift+A** does the same from the keyboard. Off
  means no scanning and nothing drawn, so it costs nothing while hidden. The choice
  is remembered in `localStorage`, so it stays off across reloads until you turn it
  back on.
- New provider options: `enabled` (the starting state before a developer has
  chosen; default `true`), `pill` (a corner, or `false` to hide it; default
  `'bottom-left'`) and `shortcut` (e.g. `'Ctrl+Alt+K'`, or `false`; default
  `'Alt+Shift+A'`). Letter and digit shortcuts match the physical key, so
  Alt/Option combinations work on macOS.
- The pill is a `role="switch"` button with visible on/off text and a 28px
  target. It's excluded from scans and from the tab-order layer, like the rest of
  the overlay. New exports: `createTogglePill`, `parseShortcut`, `matchesShortcut`,
  `formatShortcut`, `readStoredEnabled`, `writeStoredEnabled`,
  `DEFAULT_TOGGLE_SHORTCUT`, `TOGGLE_STORAGE_KEY` and their types.

### Changed

- `tabSequence` leaves out elements inside the overlay's own UI
  (`[data-ngb-a11y-overlay]`), so the pill never appears as a tab stop or counts
  as focus escaping a modal.

## 0.10.1

### Fixed

- **The JSON report now keeps a failed route's `error`.** Before, a route that
  failed to scan appeared in the JSON as a page with 0 findings, which looks clean.
  Pages now also carry `colorScheme` and `darkOnly` when set.
- **Baseline: a route that failed in the baseline is skipped** instead of counting
  everything on it as new. Re-record the baseline to cover it.
- **`ngbr/tab-order-mismatch` no longer flags moving into the next column.** Tab
  going up *and to the right* (from a sidebar into the main content, or across a
  multi-column footer) is normal reading order. Up-and-left, and leftwards on the
  same row, are still flagged. It also now compares where the previous stop *ends*
  with where the next *starts*, using line boxes, so links in wrapped paragraph text
  aren't misread. Found by running the tool on its own docs site. New export type:
  `StopRect`.
- **`ngbr/unreachable-control` / `ngbr/click-without-key` skip event delegation.** A
  click listener on a container of links or controls (with no interactive role of
  its own) handles clicks on those controls; it isn't a fake button. New export:
  `hasFocusableDescendant`.

## 0.10.0

### Added

- **Baseline mode: fail CI only on new issues.** `--baseline <file>` compares a run
  with a previous run's JSON report (from `--out`) and reports what's **new**,
  **fixed** and **unchanged**. With a baseline, `--fail-on` counts only new findings,
  so an app with known issues can turn the gate on today and stop the count going up.
  - A finding's identity is route + rule + owning component + element selector.
    Angular `_ngcontent`/`_nghost` hashes are ignored (they change between builds),
    and so are impact and help text (an axe upgrade rewording a message isn't "new").
  - Matching counts duplicates. A route missing from the baseline is all new. A route
    that fails to scan isn't reported as "fixed".
  - A bad baseline path or a non-report file fails fast (exit 2), before the scan.
  - Markdown gets a "Compared with baseline" section, and new findings are marked. JSON
    gets a `baseline` block (counts + `newFindings`) and remains a valid baseline.
  - New API from `./report`: `diffAgainstBaseline`, `parseBaseline`, `findingKey`, and
    the `BaselineDiff` / `BaselineReport` / `NewFinding` types. `toMarkdown` / `toJson`
    take the diff as an optional second argument.
- **HTML report.** `--format html` (or `all`) writes one self-contained `.html` file:
  inline CSS, no scripts, no external requests. It's accessible itself (landmarks,
  sequential headings, a real data table, severity as text, AA contrast in light and
  dark), and its own report-mode scan comes back clean. New `toHtml(report, diff?)`
  export.
- **Dark-mode scanning.** Report mode used to run with the browser's default *light*
  colour scheme, so a dark theme was never switched on or contrast-checked.
  - `--color-scheme light|dark|both` (`colorScheme` in `scanPages`): the browser
    emulates that `prefers-color-scheme`. `both` scans every route twice. Dark pages
    are labelled `/route (dark)` and list only the issues that **don't also** appear
    in light, so findings aren't doubled (`PageReport.darkOnly`). The keyboard-trap walk
    runs once, in the light pass.
  - Class/attribute-toggled themes: `--dark-class <name>` / `--dark-attribute
    <name=value>` (`darkClass` / `darkAttribute`) set that on `<html>` before each
    dark-pass scan. Either implies `both`.
  - Hooks for anything else: `setup(page, { colorScheme })` now runs once per pass
    in a fresh browser context, and the new `beforeScan(page, { colorScheme, route })`
    runs after every route loads.
  - New exports: `findingsNotIn`, `DARK_ONLY_NOTE`, and the `ColorScheme` /
    `ThemeContext` types.
- `--format` now takes a comma-separated list (`md,json,html`), plus `both` (md + json,
  still the default) and `all`.
- The real-browser E2E spec now runs the CLI itself: output formats and the baseline
  gate (passes with no new issues, fails on a new serious one, rejects a bad baseline).

## 0.9.0

### Added

- **Keyboard & Focus Mode, M3 (part 2): keyboard-trap detection with real Tab
  presses.** New opt-in report-mode flag `--focus-traps` (`focusTraps: true` in
  `scanPages`). It walks each route with real Tab key presses and reports
  **`ngbr/focus-trap`** when focus cycles inside part of the page and never moves on
  ([WCAG 2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)).
  The finding goes on the element holding the cycle and counts the controls that
  were never reached. It's **serious** when Shift+Tab is trapped too, and
  **moderate** when Shift+Tab escapes.
  - Focus cycling inside an open `aria-modal` / `<dialog>` is containment, not a
    trap, so it isn't reported. Repeated focus on an `<iframe>` (tabbing inside the
    frame) isn't read as a trap.
  - The walk runs after the scan, since pressing Tab can change page state.
  - New public API: `detectTabTrap` (pure walk classifier), `createFocusWalkProbe`,
    and the `FocusObservation` / `TabWalkVerdict` / `FocusWalkProbe` types.
  - **Honesty guardrail:** a candidate, labelled "verify manually". A widget that
    keeps Tab on purpose (a code editor) is fine if it documents another exit.
- **Real-browser E2E test.** `src/testing/e2e-report.spec.ts` drives the built
  report-mode through Chromium over local fixture pages: axe, layout-dependent
  tab order, and the trap walk. CI now installs Chromium so it runs there. It
  skips itself when `dist/` or a Playwright Chromium is missing.

## 0.8.0

### Added

- **Keyboard & Focus Mode — M3 (part 1): missing focus-trap detection.** A new
  `ngbr/modal-focus-not-contained` finding (part of the `keyboard` layer) flags an
  open `aria-modal="true"` whose focus isn't contained — i.e. tabbable elements
  outside the modal are still reachable, so a keyboard user can Tab out to the page
  behind it. Reuses the M1 tab-order machinery (which already drops `inert`/hidden
  subtrees), so a modal that correctly inerts the background is **not** flagged.
  - New public API: `findUncontainedModals` and the `UncontainedModal` type.
  - **Honesty guardrail:** a candidate, labelled "verify manually", never a verdict.
  - The *bad-trap* half of M3 ("you can Tab in but never Tab out") needs real Tab
    key presses to observe and is a headless report-mode (Playwright) follow-up.

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
