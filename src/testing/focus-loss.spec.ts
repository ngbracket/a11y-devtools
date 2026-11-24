import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFocusLossProbe,
  describeNavigation,
  type FocusLossProbe,
  type NavigationRecord,
} from '../navigation/focus-loss';
import { OVERLAY_ATTR } from '../overlay';
import type { A11yFinding } from '../scan';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // MutationObserver delivery

/** Stub `window.ng` so attribution names the component that owns each node. */
function withOwners(owners: Map<Element, string>): void {
  const component = (name: string) => ({ constructor: { name } });
  (globalThis as { ng?: unknown }).ng = {
    getComponent: () => null,
    getOwningComponent: (el: Element) => (owners.has(el) ? component(owners.get(el)!) : null),
    getDirectives: () => [],
    getListeners: () => [],
  };
}

describe('createFocusLossProbe', () => {
  let route = '/a';
  let probe: FocusLossProbe | undefined;
  let found: { finding: A11yFinding; route: string }[];
  let navs: NavigationRecord[];

  const start = (options: { focusTarget?: string } = {}) => {
    probe = createFocusLossProbe(document, {
      graceMs: 5,
      route: () => route,
      onFinding: (finding, page) => found.push({ finding, route: page }),
      onNavigation: (record) => navs.push(record),
      ...options,
    });
    return probe;
  };

  beforeEach(() => {
    route = '/a';
    found = [];
    navs = [];
    document.title = 'A';
  });

  afterEach(() => {
    probe?.stop();
    probe = undefined;
    document.body.innerHTML = '';
    delete (globalThis as { ng?: unknown }).ng;
  });

  it('reports a focused element removed by a re-render, named after its owner', async () => {
    document.body.innerHTML = '<ul id="list"><li><button class="remove">Remove</button></li></ul>';
    const button = document.querySelector('button')!;
    withOwners(new Map([[button, 'TodoListComponent']]));
    const p = start();
    button.focus();
    button.closest('li')!.remove();
    await flush();
    await p.settled();

    expect(found).toHaveLength(1);
    expect(found[0].route).toBe('/a');
    expect(found[0].finding).toMatchObject({
      id: 'ngbr/focus-lost-on-rerender',
      impact: 'moderate',
      component: 'TodoListComponent',
      target: 'button.remove',
      locator: 'ul#list',
      wcag: ['2.4.3'],
    });
  });

  it('does not report a removal when focus is put somewhere else in time', async () => {
    document.body.innerHTML = '<button id="open">Open</button><div id="dialog"><button id="close">Close</button></div>';
    const p = start();
    document.getElementById('close')!.focus();
    document.getElementById('dialog')!.remove();
    document.getElementById('open')!.focus(); // a dialog restoring focus to its trigger
    await flush();
    await p.settled();
    expect(found).toEqual([]);
  });

  it('does not report an element that lost focus to the page body before it was removed', async () => {
    document.body.innerHTML = '<button id="remove">Remove</button>';
    const p = start();
    const button = document.getElementById('remove')!;
    button.focus();
    button.blur(); // a click on the page background
    await flush();
    button.remove();
    await flush();
    await p.settled();
    expect(found).toEqual([]);
  });

  it('does not blame a route change on an element that lost focus earlier', async () => {
    document.body.innerHTML = '<div id="view"><input id="search"></div>';
    const p = start();
    const input = document.getElementById('search')!;
    input.focus();
    input.blur(); // then a click on a card that navigates
    await flush();
    route = '/b';
    document.getElementById('view')!.remove();
    await flush();
    p.notifyStable();
    await p.settled();
    expect(found).toEqual([]);
    expect(navs[0]).toMatchObject({ focus: 'body', focusBefore: null });
  });

  it('does not blame a route change on a focused element that is still in the page', async () => {
    document.body.innerHTML = '<header><a href="/b" id="persist">Next</a></header>';
    const p = start();
    const link = document.getElementById('persist')!;
    link.focus();
    route = '/b';
    // jsdom can't move focus to the body without a blur, so leave the snapshot in place.
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.body);
    p.notifyStable();
    await p.settled();
    vi.restoreAllMocks();
    expect(found).toEqual([]);
    expect(navs[0]).toMatchObject({ focus: 'body', focusBefore: 'a#persist' });
  });

  it('includes hash routes, but not in-page anchors', async () => {
    probe = createFocusLossProbe(document, { graceMs: 5, onNavigation: (r) => navs.push(r) });
    history.pushState(null, '', '#section');
    probe.notifyStable();
    await probe.settled();
    expect(navs).toEqual([]);
    history.pushState(null, '', '#/orders');
    probe.notifyStable();
    await probe.settled();
    expect(navs[0]?.to).toMatch(/#\/orders$/);
    history.pushState(null, '', '/');
  });

  it('ignores removals of elements that did not have focus', async () => {
    document.body.innerHTML = '<button id="keep">Keep</button><p id="gone">Gone</p>';
    const p = start();
    document.getElementById('keep')!.focus();
    document.getElementById('gone')!.remove();
    await flush();
    await p.settled();
    expect(found).toEqual([]);
  });

  it('ignores the devtools’ own UI', async () => {
    document.body.innerHTML = `<div ${OVERLAY_ATTR}><button>Menu</button></div>`;
    const p = start();
    document.querySelector('button')!.focus();
    document.querySelector(`[${OVERLAY_ATTR}]`)!.remove();
    await flush();
    await p.settled();
    expect(found).toEqual([]);
  });

  it('reports focus lost on a route change once, as a navigation finding', async () => {
    document.body.innerHTML = '<main><nav id="side"><a href="/b" class="next">Next</a></nav></main>';
    const link = document.querySelector('a')!;
    withOwners(new Map([[link, 'SideNavComponent']]));
    const p = start();
    link.focus();
    // The router swaps the view: URL first, then the old view goes.
    route = '/b';
    document.getElementById('side')!.remove();
    await flush();
    p.notifyStable();
    await p.settled();

    expect(found.map((f) => f.finding.id)).toEqual(['ngbr/focus-lost-on-navigation']);
    expect(found[0]).toMatchObject({ route: '/b', finding: { component: 'SideNavComponent', target: 'a.next' } });
    expect(navs).toEqual([
      expect.objectContaining({
        from: '/a',
        to: '/b',
        focus: 'body',
        focusBefore: 'a.next',
        titleChanged: false,
        announcements: [],
      }),
    ]);
  });

  it('records focus moved to the new heading, a new title and an announcement, with no finding', async () => {
    document.body.innerHTML =
      '<div role="status" id="status"></div><a href="/b">Next</a><main id="view"></main>';
    // (The announcement is made before the app settles, as a router announcer would.)
    const p = start();
    document.querySelector('a')!.focus();
    route = '/b';
    document.getElementById('view')!.innerHTML = '<h1 tabindex="-1">Orders</h1>';
    document.title = 'Orders';
    document.getElementById('status')!.textContent = 'Orders page loaded';
    document.querySelector('h1')!.focus();
    await flush();
    p.notifyStable();
    await p.settled();

    expect(found).toEqual([]);
    expect(navs[0]).toMatchObject({
      focus: 'target',
      focusedTarget: 'h1',
      titleBefore: 'A',
      titleAfter: 'Orders',
      titleChanged: true,
      announcements: ['Orders page loaded'],
    });
    expect(describeNavigation(navs[0])).toBe(
      '/a → /b: focus on h1, title changed, announced "Orders page loaded"',
    );
  });

  it('labels focus outside the expected target as other', async () => {
    document.body.innerHTML = '<header><a href="/b" id="persist">Next</a></header><main></main>';
    const p = start();
    document.getElementById('persist')!.focus();
    route = '/b';
    p.notifyStable();
    await p.settled();
    expect(navs[0]).toMatchObject({ focus: 'other', focusedTarget: 'a#persist' });
    expect(found).toEqual([]);
  });

  it('does nothing while the route stays the same', async () => {
    const p = start();
    p.notifyStable();
    await p.settled();
    expect(navs).toEqual([]);
  });

  it('stops watching on stop()', async () => {
    document.body.innerHTML = '<button>Remove</button>';
    const p = start();
    document.querySelector('button')!.focus();
    p.stop();
    document.querySelector('button')!.remove();
    await flush();
    await p.settled();
    expect(found).toEqual([]);
  });
});
