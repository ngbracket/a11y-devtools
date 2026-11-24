/**
 * A route change as the focus-loss probe recorded it. Kept apart from the probe,
 * with no imports, so the report formatters (which also run in Node) can use it.
 */

/** Where focus ended up after a route change. */
export type NavigationFocus = 'body' | 'target' | 'other';

/** One route change, as the probe saw it. */
export interface NavigationRecord {
  /** Route before (`pathname + search`, plus a `#/` hash). */
  from: string;
  /** Route after. */
  to: string;
  /**
   * How the change was made, when the driver knows: `link` (a link was
   * activated from the keyboard) or `history` (`history.pushState` and a
   * `popstate` event). Unset in the app.
   */
  via?: 'link' | 'history';
  /** `body`: focus was lost; `target`: inside the expected focus target; `other`: anywhere else. */
  focus: NavigationFocus;
  /** Short selector of the focused element after the change; null when focus is on `<body>`. */
  focusedTarget: string | null;
  /** Component that owns the focused element after the change. */
  focusedComponent: string | null;
  /** Short selector of the element that had focus before the change, if any. */
  focusBefore: string | null;
  titleBefore: string;
  titleAfter: string;
  titleChanged: boolean;
  /** Text live regions announced after the change, in order. */
  announcements: string[];
}

/** One line for a route change: "/a → /b: focus on body, title unchanged, nothing announced". */
export function describeNavigation(record: NavigationRecord): string {
  const focus =
    record.focus === 'body'
      ? 'focus on body'
      : `focus on ${record.focusedTarget ?? 'an element'}`;
  const title = record.titleChanged ? 'title changed' : 'title unchanged';
  const said = record.announcements.length
    ? `announced "${record.announcements.join(' / ')}"`
    : 'nothing announced';
  return `${record.from} → ${record.to}: ${focus}, ${title}, ${said}`;
}
