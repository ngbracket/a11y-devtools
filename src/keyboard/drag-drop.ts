/**
 * What marks a list whose items move by drag and drop, and what counts as a
 * keyboard way to move them. The keyboard scan reports such a list when it finds
 * no keyboard way (`ngbr/drag-without-keyboard`): Angular CDK drag-drop has no
 * keyboard support of its own, so a CDK list is mouse-only unless the app adds it.
 *
 * Drag items are recognised by DOM markers that are there in production builds
 * too: the `cdk-drag` class that `cdkDrag` puts on its host (only inside a
 * `cdk-drop-list`; a free-standing `cdkDrag`, such as a draggable dialog title,
 * moves something around the screen and is left out), and an explicit
 * `draggable="true"` (native HTML drag and drop, ngx-drag-drop's `dndDraggable`).
 */

/** A list of drag items under one container. */
export interface DragGroup {
  /** The drop list, or the items' parent for native drag and drop. */
  container: Element;
  /** The items that can be dragged now (not disabled, not hidden). */
  items: Element[];
}

const DRAG_ITEM_SELECTOR = '.cdk-drop-list .cdk-drag, [draggable="true"]';

/**
 * Names of controls that move an item: "Move up", "Move to top", "Earlier",
 * arrow glyphs, and the Material icon ligatures for up and down arrows.
 */
const MOVE_NAME =
  /\b(move|up|down|top|bottom|earlier|later|raise|lower|reorder)\b|[↑↓⬆⬇▲▼]|\b(arrow_upward|arrow_downward|keyboard_arrow_up|keyboard_arrow_down|north|south)\b/i;

const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="menuitem"]';

/**
 * The drag lists in `root`, one per container. CDK items group by their
 * `cdk-drop-list`; native ones by their parent. A disabled list or item (CDK's
 * `cdk-drop-list-disabled` / `cdk-drag-disabled`) and CDK's drag preview and
 * placeholder are left out.
 */
export function dragGroups(root: ParentNode, isHidden: (el: Element) => boolean): DragGroup[] {
  const groups = new Map<Element, Element[]>();
  for (const item of root.querySelectorAll(DRAG_ITEM_SELECTOR)) {
    if (item.matches('.cdk-drag-disabled, .cdk-drag-preview, .cdk-drag-placeholder')) continue;
    const container = item.classList.contains('cdk-drag') ? item.closest('.cdk-drop-list') : item.parentElement;
    if (!container || container.classList.contains('cdk-drop-list-disabled')) continue;
    if (isHidden(item)) continue;
    const items = groups.get(container) ?? [];
    items.push(item);
    groups.set(container, items);
  }
  return [...groups].map(([container, items]) => ({ container, items }));
}

/**
 * Where a keyboard user would start a move for `item`: its CDK drag handles that
 * belong to it (not to a nested drag item), or the item itself.
 */
export function dragHandles(item: Element): Element[] {
  const handles = [...item.querySelectorAll('.cdk-drag-handle')].filter(
    (handle) => handle.closest('.cdk-drag, [draggable="true"]') === item,
  );
  return handles.length > 0 ? handles : [item];
}

/** A rough accessible name for a control: aria-label, title, then its text. */
function roughName(element: Element): string {
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => (id ? element.ownerDocument?.getElementById(id)?.textContent ?? '' : ''))
    .join(' ');
  return [element.getAttribute('aria-label'), labelledBy, element.getAttribute('title'), element.textContent]
    .filter(Boolean)
    .join(' ');
}

/**
 * True when there's a control near the list whose name says it moves an item
 * ("Move up", "↓", an `arrow_upward` icon): in the list or next to it, inside
 * the list's parent. A drag handle doesn't count, even one named "Reorder":
 * whether it works from the keyboard depends on its key handling, which the
 * scan checks separately. `isTabbable` decides whether the keyboard can reach it.
 */
export function hasMoveControl(container: Element, isTabbable: (el: Element) => boolean): boolean {
  const scope = container.parentElement ?? container;
  for (const control of scope.querySelectorAll(CONTROL_SELECTOR)) {
    if (control.closest('.cdk-drag-handle')) continue;
    if (MOVE_NAME.test(roughName(control)) && isTabbable(control)) return true;
  }
  return false;
}
