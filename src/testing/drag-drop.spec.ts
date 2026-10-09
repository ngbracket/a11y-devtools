import { afterEach, describe, expect, it } from 'vitest';
import { RULE_DOCS, scanKeyboard } from '../keyboard/keyboard-scan';
import { dragGroups, dragHandles } from '../keyboard/drag-drop';

/** Install a fake `window.ng` whose `getListeners` reports `listeners`. */
function withNg(
  fn: () => void,
  listeners: Map<Element, string[]> = new Map(),
  hosts: ReadonlySet<Element> = new Set(),
): void {
  const original = (globalThis as { ng?: unknown }).ng;
  (globalThis as { ng?: unknown }).ng = {
    getComponent: (el: Element) => (hosts.has(el) ? {} : null),
    getOwningComponent: () => null,
    getDirectives: () => [],
    getListeners: (el: Element) => (listeners.get(el) ?? []).map((name) => ({ name, type: 'dom' as const })),
  };
  try {
    fn();
  } finally {
    (globalThis as { ng?: unknown }).ng = original;
  }
}

/** Run `fn` with no `window.ng`, as in a production build. */
function withoutNg(fn: () => void): void {
  const original = (globalThis as { ng?: unknown }).ng;
  (globalThis as { ng?: unknown }).ng = undefined;
  try {
    fn();
  } finally {
    (globalThis as { ng?: unknown }).ng = original;
  }
}

function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const drag = (host: ParentNode) => scanKeyboard(host).filter((f) => f.id === 'ngbr/drag-without-keyboard');

/** A CDK table whose rows reorder by a drag-handle icon, like a list of levels. */
const row = (name: string, extra = '') => `
  <tr class="cdk-drag">
    <td><mat-icon class="cdk-drag-handle">drag_indicator</mat-icon></td>
    <td><input aria-label="Name" value="${name}" /></td>
    ${extra}
  </tr>`;
const table = (rows: string, listClass = '') => `
  <table><tbody id="levels" class="cdk-drop-list ${listClass}">${rows}</tbody></table>`;

describe('ngbr/drag-without-keyboard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('flags a CDK drop list whose handles Tab never reaches, once, on the list', () => {
    const host = fixture(table(row('Novice') + row('Beginner') + row('Adept')));
    const found = drag(host);
    expect(found).toHaveLength(1);
    expect(found[0].impact).toBe('serious');
    expect(found[0].target).toContain('levels');
    expect(found[0].help).toContain('3 items here move');
    expect(found[0].help).toContain('Heuristic — verify manually');
    expect(found[0].helpUrl).toBe(`${RULE_DOCS}/drag-without-keyboard`);
  });

  it('skips a list with Move up / Move down buttons in its rows', () => {
    const buttons = '<td><button>Move up</button><button>Move down</button></td>';
    const host = fixture(table(row('Novice', buttons) + row('Beginner', buttons)));
    expect(drag(host)).toEqual([]);
  });

  it('skips icon-only move buttons named by a Material arrow ligature or aria-label', () => {
    const icons = '<td><button><mat-icon>arrow_upward</mat-icon></button></td>';
    expect(drag(fixture(table(row('Novice', icons))))).toEqual([]);
    document.body.innerHTML = '';
    const labelled = '<td><button aria-label="Move Novice earlier"><svg></svg></button></td>';
    expect(drag(fixture(table(row('Novice', labelled))))).toEqual([]);
  });

  it('skips a move control next to the list, such as a toolbar above it', () => {
    const host = fixture(`
      <section>
        <div role="toolbar"><button>Move selected up</button></div>
        <ul class="cdk-drop-list"><li class="cdk-drag" tabindex="-1">One</li></ul>
      </section>`);
    expect(drag(host)).toEqual([]);
  });

  it("doesn't let one list's Move buttons vouch for a list beside it", () => {
    const host = fixture(`
      <section>
        <ol class="cdk-drop-list" id="mouse-only"><li class="cdk-drag"><span class="cdk-drag-handle">⠿</span>A</li></ol>
        <ol class="cdk-drop-list" id="with-buttons"><li class="cdk-drag"><span class="cdk-drag-handle">⠿</span>A<button>Move A down</button></li></ol>
      </section>`);
    expect(drag(host).map((f) => f.target)).toEqual([expect.stringContaining('mouse-only')]);
  });

  it('still flags a list whose move buttons Tab can\'t reach', () => {
    const disabled = '<td><button disabled>Move up</button></td>';
    expect(drag(fixture(table(row('Novice', disabled))))).toHaveLength(1);
  });

  it('skips a focusable handle that handles keys (dev build)', () => {
    const host = fixture(`
      <ul class="cdk-drop-list">
        <li class="cdk-drag"><button class="cdk-drag-handle" aria-label="Reorder One">⠿</button>One</li>
      </ul>`);
    const handle = host.querySelector('.cdk-drag-handle')!;
    withNg(() => expect(drag(host)).toEqual([]), new Map([[handle, ['keydown.arrowup']]]));
  });

  it('skips a focusable handle when a row or list listener handles the keys', () => {
    const host = fixture(`
      <ul class="cdk-drop-list">
        <li class="cdk-drag"><button class="cdk-drag-handle" aria-label="Reorder One">⠿</button>One</li>
      </ul>`);
    const item = host.querySelector('.cdk-drag')!;
    withNg(() => expect(drag(host)).toEqual([]), new Map([[item, ['keydown']]]));
  });

  it('reports a focusable handle with no key handling as moderate (dev build)', () => {
    const host = fixture(`
      <ul class="cdk-drop-list">
        <li class="cdk-drag"><button class="cdk-drag-handle" aria-label="Reorder One">⠿</button>One</li>
      </ul>`);
    withNg(() => {
      const found = drag(host);
      expect(found).toHaveLength(1);
      expect(found[0].impact).toBe('moderate');
      expect(found[0].help).toContain('nothing on them handles keys');
    });
  });

  it('gives a focusable handle the benefit of the doubt in a production build', () => {
    const host = fixture(`
      <ul class="cdk-drop-list">
        <li class="cdk-drag"><button class="cdk-drag-handle" aria-label="Reorder One">⠿</button>One</li>
      </ul>`);
    withoutNg(() => expect(drag(host)).toEqual([]));
  });

  it('still flags an unreachable handle in a production build (markers only)', () => {
    const host = fixture(table(row('Novice')));
    withoutNg(() => expect(drag(host)).toHaveLength(1));
  });

  it('skips a roving-tabindex board: cards with tabindex="-1" that handle keys', () => {
    // Like @ngbracket/board: one card on the whole board is the tab stop and arrow
    // keys move between the rest, so a column can have no tab stop of its own.
    const host = fixture(`
      <div class="cdk-drop-list" role="list"><div class="cdk-drag" role="listitem" tabindex="0">A</div></div>
      <div class="cdk-drop-list" role="list"><div class="cdk-drag" role="listitem" tabindex="-1">B</div></div>`);
    const cards = [...host.querySelectorAll('.cdk-drag')];
    withNg(() => expect(drag(host)).toEqual([]), new Map(cards.map((c) => [c, ['keydown']])));
    withoutNg(() => expect(drag(host)).toEqual([]));
  });

  it('reports tabindex="-1" items with no key handling as moderate (dev build)', () => {
    const host = fixture(`<ul class="cdk-drop-list"><li class="cdk-drag" tabindex="-1">One</li></ul>`);
    withNg(() => expect(drag(host).map((f) => f.impact)).toEqual(['moderate']));
  });

  it('skips disabled lists and items, and a cdkDrag outside a drop list', () => {
    expect(drag(fixture(table(row('Novice'), 'cdk-drop-list-disabled')))).toEqual([]);
    document.body.innerHTML = '';
    const disabledRow = row('Novice').replace('class="cdk-drag"', 'class="cdk-drag cdk-drag-disabled"');
    expect(drag(fixture(table(disabledRow)))).toEqual([]);
    document.body.innerHTML = '';
    expect(drag(fixture('<div class="cdk-drag"><h2>Drag me</h2></div>'))).toEqual([]);
  });

  it('skips hidden items', () => {
    const hiddenRow = row('Novice').replace('<tr class="cdk-drag">', '<tr class="cdk-drag" hidden>');
    expect(drag(fixture(table(hiddenRow)))).toEqual([]);
  });

  it('flags native draggable="true" lists as moderate, grouped by their parent', () => {
    const host = fixture(`
      <ul id="cards"><li draggable="true">One</li><li draggable="true">Two</li></ul>
      <ul id="other"><li draggable="true">Three</li><li draggable="true">Four</li></ul>`);
    const found = drag(host);
    expect(found.map((f) => f.target)).toEqual([expect.stringContaining('cards'), expect.stringContaining('other')]);
    expect(found.map((f) => f.impact)).toEqual(['moderate', 'moderate']);
  });

  it('skips a lone draggable="true" element, such as an image to drag out of the page', () => {
    expect(drag(fixture('<p><img draggable="true" alt="Logo" src="x.png" /></p>'))).toEqual([]);
  });

  it('says "1 item" for a list of one', () => {
    expect(drag(fixture(table(row('Novice'))))[0].help).toContain('1 item here moves');
  });

  it('is not silenced by "Sign up" or "Back to top" near the list', () => {
    const host = fixture(`
      <section>
        <a href="#top">Back to top</a><button>Sign up</button>
        ${table(row('Novice') + row('Beginner'))}
      </section>`);
    expect(drag(host)).toHaveLength(1);
  });

  it('accepts a whole-name "Up" / "Down" button', () => {
    expect(drag(fixture(table(row('Novice', '<td><button>Up</button><button>Down</button></td>'))))).toEqual([]);
  });

  it('finds key handling on a component host above the list (a sortable tab list)', () => {
    const host = fixture(`
      <app-tabs><div class="wrapper">
        <div class="cdk-drop-list" role="tablist">
          <div class="cdk-drag" role="tab" tabindex="0">One</div><div class="cdk-drag" role="tab" tabindex="-1">Two</div>
        </div>
      </div></app-tabs>`);
    const appTabs = host.querySelector('app-tabs')!;
    const wrapper = host.querySelector('.wrapper')!;
    withNg(() => expect(drag(host)).toEqual([]), new Map([[wrapper, ['keydown']]]), new Set([appTabs]));
  });

  it('stops looking for key handling at the component host', () => {
    const host = fixture(`
      <div class="page"><app-list>
        <div class="cdk-drop-list"><div class="cdk-drag" tabindex="0">One</div></div>
      </app-list></div>`);
    const page = host.querySelector('.page')!;
    const appList = host.querySelector('app-list')!;
    withNg(() => expect(drag(host)).toHaveLength(1), new Map([[page, ['keydown']]]), new Set([appList]));
  });
});

describe('dragGroups and dragHandles', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('groups CDK items by drop list and ignores the drag preview and placeholder', () => {
    const host = fixture(`
      <div class="cdk-drop-list" id="a">
        <div class="cdk-drag">1</div><div class="cdk-drag cdk-drag-placeholder">p</div>
      </div>
      <div class="cdk-drop-list" id="b"><div class="cdk-drag">2</div></div>
      <div class="cdk-drag cdk-drag-preview">preview</div>`);
    const groups = dragGroups(host, () => false);
    expect(groups.map((g) => [g.container.id, g.items.length])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('groups an item that is also a drop list under the list around it', () => {
    const host = fixture(`
      <div class="cdk-drop-list" id="outer">
        <div class="cdk-drag cdk-drop-list" id="both"><div class="cdk-drag">child</div></div>
      </div>`);
    const groups = dragGroups(host, () => false);
    expect(groups.map((g) => [g.container.id, g.items.length])).toEqual([
      ['outer', 1],
      ['both', 1],
    ]);
  });

  it("returns an item's own handles, not a nested item's, else the item", () => {
    const host = fixture(`
      <div class="cdk-drop-list">
        <div class="cdk-drag" id="outer">
          <span class="cdk-drag-handle" id="h1"></span>
          <div class="cdk-drop-list"><div class="cdk-drag" id="inner"><span class="cdk-drag-handle" id="h2"></span></div></div>
        </div>
        <div class="cdk-drag" id="plain">no handle</div>
      </div>`);
    const ids = (id: string) => dragHandles(host.querySelector(`#${id}`)!).map((el) => el.id);
    expect(ids('outer')).toEqual(['h1']);
    expect(ids('inner')).toEqual(['h2']);
    expect(ids('plain')).toEqual(['plain']);
  });
});
