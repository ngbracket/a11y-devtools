# Changelog

All notable changes to `@ngbracket/a11y-devtools` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 0.16.1

### Added

- New keyboard rule `ngbr/drag-without-keyboard`. It reports a list whose items
  move by drag and drop when the tool finds no keyboard way to move them.
  Angular CDK drag and drop has no keyboard support of its own, so a list of
  rows with `cdkDragHandle` icons is mouse-only unless the app adds one. The
  rule finds drag items by the `cdk-drag` class inside a `cdk-drop-list`, and
  by `draggable="true"` when a parent holds two or more, in any build. It
  reports each list once. It skips a list with a tab stop in or next to it
  whose name says it moves an item ("Move up", "Reorder", an arrow, a Material
  `arrow_upward` icon). Serious when the keyboard can't reach a drag handle of a
  CDK list; moderate for a native `draggable` list. A handle or item with a
  `tabindex` counts as reachable when a drag list on the page has a tab stop,
  as in a board where one card is the tab stop and the arrow keys move to the
  rest. Moderate in a dev build when a handle is reachable but no Angular key
  listener sits on the handle, its item, the list, or the elements up to and
  including the component that holds the list. Maps to WCAG 2.1.1 and
  2.5.7 in the ACR worksheet.

### Fixed

- The tab-order layer now hides the page's tab stops while an Angular Material
  dialog is open. Material 22 opens `mat-dialog` with `aria-modal="false"` by
  default and hides the page from screen readers with `aria-hidden`. The
  scanner only looked for the CDK focus trap around `aria-modal="true"`
  elements, so it missed the trap and numbered the page's stops under the
  dialog as well as the dialog's own. It now finds the trap around any
  `mat-dialog-container`, `.cdk-dialog-container` or dialog role. Report mode
  also no longer counts Tab cycling inside a default `mat-dialog` as a
  `ngbr/focus-trap` finding.
- The scanner now recognises the focus traps in PrimeNG, ngx-bootstrap and
  ng-bootstrap dialogs. PrimeNG and ngx-bootstrap put their sentinels inside
  the dialog, as its first and last tab stops. ng-bootstrap's modal and
  offcanvas trap Tab with a script and no sentinels, so they're recognised by
  element name. Before, the tab-order layer showed the page's stops under these
  dialogs, and `ngbr/modal-focus-not-contained` reported a leak that wasn't
  there.

## 0.16.0

### Added

- New keyboard rule `ngbr/hover-only-content`. It reports an element that shows
  content on hover when Tab can't reach it, so keyboard users may never see that
  content. An info icon with a tooltip in a table row is the common case. The
  rule looks for:
  - a tooltip from Angular Material, PrimeNG, ng-bootstrap, ngx-bootstrap,
    ng-zorro, Taiga UI or helipopper, by its directive class in a dev build or
    by its attribute or host class in any build. Moderate. An empty tooltip
    attribute is skipped in every build. In a dev build, a tooltip switched off
    through its directive is skipped too (Material, PrimeNG, ng-bootstrap,
    ngx-bootstrap, ng-zorro and helipopper), and so is Material's
    `matTooltipDisabled` in any build.
  - an HTML `interestfor` attribute. Moderate.
  - an Angular `(mouseenter)`, `(mouseover)`, `(pointerenter)` or
    `(pointerover)` listener (dev builds). Minor, since such a listener can also
    do something else, such as highlight a row.
  - a `title` on an icon with no visible text, unless it repeats the icon's
    `alt` or `aria-label`. Minor.

  A disabled control with a tooltip, or a wrapper around one, gets its own
  message: a disabled control can't take focus, so use `aria-disabled="true"`
  instead. The rule skips an element inside something Tab reaches (an icon in a
  link), a wrapper around something Tab reaches, and anything inside an
  element already reported. It runs with the keyboard layer and maps to WCAG
  2.1.1 in the ACR worksheet. Like the other keyboard rules, it is a heuristic
  to check by hand.

  If you gate CI on a baseline, findings from this rule show as new after you
  upgrade. Update the baseline once you've checked them.

### Fixed

- The overlay now draws each keyboard finding on its own element. Keyboard
  findings use a short selector such as `mat-icon.info`, and when that matched
  an element repeated in every table row, the overlay drew all the findings on
  the first match. Findings now carry a `locator` as well: a selector that
  matches only that element, which the overlay uses. `target` is unchanged, so
  baselines are unaffected.

## 0.15.8

### Fixed

- Report mode now checks colour contrast below the fold when the app runs the
  in-app overlay. The overlay's tab-order path is drawn on a fixed SVG that
  runs past the bottom of the viewport. axe counted it as covering the text
  there, so its contrast check returned "needs review" instead of a result,
  and report mode doesn't list those. Contrast problems on parts of a page
  below the report's 900px-tall viewport could go unreported, in light and
  dark passes. Report mode now hides the overlay before it scans. On the
  public demo this brings back two dark-mode contrast failures the dark pass
  had missed.

## 0.15.7

### Fixed

- The keyboard tab-order badges now pass a colour contrast check. Their white
  digits sat on a teal fill at 3.93:1, below the 4.5:1 that text this size
  needs, and axe flagged them on a dark-mode page. The fill is now `#0a7a7a`
  (5.15:1). The orange badge for a positive `tabindex` had the same problem
  (3.09:1) and is now `#b45309` (5.02:1). The lines joining the badges keep
  their teal.
- The finding labels now pass a colour contrast check too. Their white text
  sat on the impact colour, which gave 2.42:1 to 4.11:1 for every impact except
  critical. Labels now use a darker fill in the same hue: serious `#b45309`,
  moderate `#8a6d00`, minor `#2563c4` and no impact `#666666`, all at least
  4.9:1. The box outlines keep the original impact colours.

## 0.15.6

### Fixed

- **The Focus preview card is now headed "Focus preview".** It used to say
  "Accessibility-tree preview", which didn't match the "Focus preview" setting
  in the pill menu, so the card and its switch were hard to connect. It is
  still labelled a computed approximation.
- **Turning Focus preview on shows the card without waiting for focus to
  move.** Before, nothing appeared until focus next moved. Now, switching the
  setting on describes the control that already has focus; switching the whole
  tool on does the same once its first scan finishes. When you toggle it
  from the pill menu, it describes the page control you were on before.
- **The Focus preview no longer shows an empty name while a scan is running.**
  axe can't compute an accessible name during its own run, so a control
  focused mid-scan showed "(no accessible name)". The preview now waits for the
  scan to finish and describes only the latest focus. A `describeElement` call
  made during a scan also no longer tears down the scan's axe tree, which had
  silently dropped that scan's findings.

## 0.15.5

### Fixed

- **`ngbr/unreachable-control` accepts one roving tab stop shared by several
  widgets.** A kanban board with a `role="listbox"` per column and a single tab
  stop for the whole board had every card in the other columns reported as
  serious, although Tab reaches the board and the arrow keys cross columns. An
  item is now also reachable when another widget of the same role, inside the
  same component and repeated alongside it (the same element with the same
  classes, as a `@for` over columns renders; Angular's `ng-*` classes and BEM
  `--modifiers` are ignored), has a tabbable item of the same role. So a
  working listbox can't vouch for an unrelated broken one elsewhere in the
  template, and key handling is still required. Development builds only: it
  needs Angular's debug API to find the component, so a production-build scan
  still reports these items. Found on our own docs: 13 false positives → 0.

## 0.15.4

### Fixed

- **`ngbr/unreachable-control` checks that arrow keys are handled before
  skipping a roving-tabindex item.** 0.15.2 skipped an item with
  `tabindex="-1"` whenever Tab could get into its composite widget, so a half-built
  tab list (the first tab at `tabindex="0"`, the rest at `-1`, no arrow-key
  handling) passed silently. The item is now skipped only when something handles
  keys: the widget, anything inside it, an element that controls it, or an
  element around it up to and including the nearest component's host (so an app
  shell's shortcut listener doesn't count). When nothing does, it's reported as
  moderate, to verify by hand. Without Angular's dev-mode debug API (a
  production build), listeners can't be read, so these items are still skipped.
- **Key listeners bound with modifiers now count as key handling.** Angular
  reports `(keydown.enter)` as `keydown.enter`, which wasn't recognised, so
  `ngbr/click-without-key` flagged a control with `(click)`, `(keydown.enter)`
  and `(keydown.space)`: the fix its own docs recommend. The same applies to
  `(keydown.arrowRight)` and friends in the checks above.
- **The mouse-shortcut skip no longer hides `ngbr/click-without-key`.** 0.15.3's
  skip for click-only parts of a keyboard-operated widget ran before the
  Tab-reachability check, so a click-only element Tab *does* reach, inside such a
  widget, got no finding at all. The skip now applies only to elements Tab can't
  reach.
- `--from` with `--serve` no longer also names `--base` in its error message.

## 0.15.3

### Fixed

- **`ngbr/unreachable-control` no longer flags mouse shortcuts inside a
  keyboard-operated widget.** A click-only element with no role of its own is
  skipped when it's part of something the keyboard already operates: a
  composite-widget item Tab or arrow keys reach (a tree's expand/collapse arrow
  inside its treeitem, which ←/→ expand), or the nearest Tab-reachable ancestor
  that handles keys itself (the bars, slices and points of a focusable chart
  that moves between them with arrow keys). A page-wide key listener doesn't
  count, and a click target inside a focusable ancestor with no key handling is
  still reported. Found on our own docs (dev build): 83 false positives → 0.

## 0.15.2

### Fixed

- **`ngbr/unreachable-control` no longer flags items that arrow keys reach.**
  In a composite widget (a tab list, toolbar, menu, menubar, radio group,
  listbox, tree, treegrid or grid), Tab reaches the widget once and arrow keys
  move between its items, so the other items are correctly out of the tab
  order. They were reported as serious. An item is now skipped when the widget
  (or a combobox that controls it) uses `aria-activedescendant`, or when the
  item has a `tabindex` and Tab can get into the widget: one item is tabbable,
  the widget is, or another element controls it (a menu button). A widget Tab
  can't enter at all, and an item script can't focus, are still reported.
  Found on our own docs: 9 false positives across the listbox, tree and
  selectable-list pages.

## 0.15.1

### Fixed

- **Collapsed sidebars no longer cause false tab-order findings.** A
  `<details>` nested inside a closed `<details>` (a group inside a collapsed
  sidebar section) had its summary counted as a tab stop, although it's hidden
  and Tab can't reach it. The next section's summary then looked like a jump
  back up the page, so `ngbr/tab-order-mismatch` fired once per section. Every
  closed `<details>` up the tree now counts. This also fixes the tab-order
  badges in the overlay. Found on our own docs site.
- **`ngbr/unreachable-control` skips hidden controls.** A custom control inside
  a closed `<details>`, a `[hidden]` or `inert` subtree, or `display: none` was
  reported as unreachable. Tab can't reach it because it isn't shown, which
  isn't a problem; it's checked once it's shown.

## 0.15.0

### Added

- **Re-render a saved report without scanning.** `--from <report.json>` reads
  a previous run's JSON report (from `--out`) and writes it in whatever
  `--format`s you ask for, so you can add an HTML report or an ACR worksheet
  later without running the scan again. `--baseline` and `--fail-on` work as
  usual; scan options such as `--route` or `--keyboard` are refused. The
  output is byte-for-byte what the original scan would have written. For the
  ACR worksheet, it notes when the report's axe-core version differs from the
  installed one, or when the report predates `checks` (0.14.0).
  From code: `parseReport()`, plus `axeVersion()` for the installed axe-core.

### Changed

- Type-checking: the specs are now type-checked in CI, and the browser source
  compiles without Node types (report mode has its own tsconfig). No change to
  the published output.

## 0.14.1

### Fixed

- **`componentPath` lists each component once.** With content projection, a
  finding's path could repeat a component, e.g.
  `HomePageComponent > PanelComponent > HomePageComponent > AppComponent` for an
  image projected into a panel. It's now
  `HomePageComponent > PanelComponent > AppComponent`. The attributed
  `component`, "via" notes and baseline matching are unchanged.

## 0.14.0

### Added

- **Evaluation worksheet for a VPAT/ACR.** `--format acr` writes
  `<prefix>.acr.html` and `--format acr-md` writes `<prefix>.acr.md`: the scan
  organised by WCAG 2.2 Level A and AA success criterion, one row per criterion.
  Each row says what the scan found — "Automated failures found", "Possible
  failures found — verify manually" (heuristic `ngbr/*` rules only), "No
  automated failures detected — manual review required", or "No automated checks
  — manual review required" — with the evidence (rule, impact, instances, pages,
  components) or the rules that checked it. It never says "Supports": the
  Conformance Level and Remarks columns, and the product, evaluator and date
  fields, are left blank for a person. Findings from rules not mapped to an A/AA
  criterion (best practices, AAA) are listed separately rather than dropped.
  From code: `buildAcrWorksheet()`, `toAcrHtml()`, `toAcrMarkdown()`.
- **Reports record what was checked.** `scanPages()` results and JSON reports
  now carry `checks`: the axe-core version, any `--tags`, and whether keyboard
  checks and the keyboard-trap walk ran.

## 0.13.0

### Added

- **Report mode can start your dev server.** `--serve "<command>"` runs the
  command (for example `--serve "npx ng serve"`), waits until `--base` answers,
  scans, then stops the server and everything it started — even on Ctrl+C or a
  cancelled CI job. `--base` defaults to `http://localhost:4200` with `--serve`.
  If something already answers at `--base`, that server is scanned and nothing is
  started, so the same command works locally with `ng serve` already running.
  `--serve-timeout <seconds>` (default 180) sets how long to wait. If the command
  exits early or never answers, the CLI exits with code `2` and prints the last
  lines of its output. From code: `startDevServer()` and `isServing()` from
  `@ngbracket/a11y-devtools/report`.

## 0.12.3

### Changed

- **Reports say what they aren't.** The Markdown and HTML reports are now titled
  "Automated accessibility scan" (was "Accessibility report") and open with a
  scope note: automated checks cover only part of WCAG, and the report is not a
  conformance report or a VPAT/ACR. The note links to
  [What it checks (and what it can't)](https://ngbracket.com/tools/a11y-devtools/docs/coverage).
  JSON reports carry the same note as a top-level `scope` field. A clean page now
  reads "No automated violations found." The in-app **Download report** gets the
  same changes.

### Fixed

- **The overlay no longer adds text to the page's accessibility tree.** Finding
  labels, tab-order numbers and the accessibility-tree preview panel were exposed
  to screen readers, mixing rule ids and badge numbers into the app being tested.
  The overlay layer is now `aria-hidden`. The on/off pill and its menu are in a
  separate layer and stay fully accessible.

## 0.12.2

### Changed

- **Every `ngbr/*` finding links to its own explanation.** `helpUrl` now points to
  the rule's page in the docs (for example
  `https://ngbracket.com/tools/a11y-devtools/docs/click-without-key`). Each page
  explains what the message means, who it affects, exactly what triggers it, how
  to fix it and how to check it yourself, and links the WCAG or APG reference. It
  used to link straight to the WCAG page.
- **Clearer messages.** Each now starts with what's wrong for the user, in plain
  words. `ngbr/click-without-key` no longer calls itself a "possible keyboard
  trap": a keyboard trap means you can't Tab away, and this rule is about a
  control you can reach but may not be able to activate. `ngbr/focus-trap` now
  starts "Keyboard trap:", which is what it finds.

## 0.12.1

### Fixed

- **Production builds really drop the devtools now.** axe-core was never loaded
  in production, but the devtools' own code (overlay, pill, menu) still ended up
  in the app's main bundle when the provider was called unconditionally or behind
  a runtime `isDevMode()` check: +28.5 KB raw (+10.4 KB gzipped) in 0.12.0 on the
  admin example. The provider now checks `ngDevMode`, which the Angular CLI sets
  to `false` in production builds, so the whole implementation is tree-shaken:
  +0.2 KB raw (+0.05 KB gzipped). A new test bundles a production-style build
  and checks the overlay, pill, menu and axe-core are all absent.
- **Rescans after top-layer changes Angular doesn't see.** Pressing Escape
  closes a native `<dialog>` without any Angular event, so the page kept the
  findings from while the modal was open until something else changed. The
  devtools now also rescan when a dialog closes or a popover opens or closes. A
  scan requested while one is running now runs once that one finishes, instead
  of being dropped.
- **Keyboard findings skip the page behind an open modal `<dialog>`.** The
  browser makes it inert, and axe already skips it, so the keyboard checks no
  longer report `ngbr/unreachable-control` and `ngbr/click-without-key` there.

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
