import { afterEach, describe, expect, it } from 'vitest';
import { createFocusWalkProbe, detectTabTrap } from '../keyboard/focus-walk';

describe('detectTabTrap', () => {
  it('is complete once focus wraps through <body> and returns to a seen element', () => {
    expect(detectTabTrap([1, 2, 3, null, 1])).toEqual({ kind: 'complete' });
  });

  it('handles a walk that starts mid-page', () => {
    expect(detectTabTrap([3, 4, null, 1, 2, 3])).toEqual({ kind: 'complete' });
  });

  it('is pending until there is evidence either way', () => {
    expect(detectTabTrap([1, 2, 3])).toEqual({ kind: 'pending' });
    expect(detectTabTrap([null, null])).toEqual({ kind: 'pending' });
  });

  it('reports a cycle that never passes through <body> as a trap', () => {
    expect(detectTabTrap([1, 2, 3, 4, 3])).toEqual({ kind: 'trap', cycle: [3, 4] });
  });

  it('reports focus that does not move at all as a one-element trap', () => {
    expect(detectTabTrap([1, 2, 2])).toEqual({ kind: 'trap', cycle: [2] });
  });

  it('collapses consecutive repeats of an iframe (tabbing inside the frame)', () => {
    const frames = new Set([2]);
    expect(detectTabTrap([1, 2, 2, 2, 3], frames)).toEqual({ kind: 'pending' });
    expect(detectTabTrap([1, 2, 2, 3, null, 1], frames)).toEqual({ kind: 'complete' });
    // …but an iframe revisited after other stops, without a lap, is still a cycle.
    expect(detectTabTrap([1, 2, 3, 2], frames)).toEqual({ kind: 'trap', cycle: [2, 3] });
  });
});

describe('createFocusWalkProbe', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function focus(id: string): void {
    (document.getElementById(id) as HTMLElement).focus();
  }

  it('gives each focused element a stable id and returns null on <body>', () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
    const walk = createFocusWalkProbe(document);

    expect(walk.probe()).toEqual({ id: null, iframe: false });
    focus('a');
    const a = walk.probe().id;
    focus('b');
    const b = walk.probe().id;
    focus('a');
    expect(walk.probe().id).toBe(a);
    expect(a).not.toBe(b);
  });

  it('builds a finding on the common ancestor of the cycle, counting unreached stops', () => {
    document.body.innerHTML = `
      <button id="before">Before</button>
      <div id="widget"><input id="x" /><input id="y" /></div>
      <button id="after">After</button>
    `;
    const walk = createFocusWalkProbe(document);
    focus('before');
    walk.probe();
    focus('x');
    const x = walk.probe().id!;
    focus('y');
    const y = walk.probe().id!;

    const finding = walk.trapFinding([x, y], false);
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe('ngbr/focus-trap');
    expect(finding!.impact).toBe('serious');
    expect(finding!.target).toBe('div#widget');
    expect(finding!.help).toContain('Tab cycles through 2 controls');
    expect(finding!.help).toContain('1 tabbable control(s)'); // "after" was never reached
    expect(finding!.helpUrl).toBe('https://ngbracket.com/tools/a11y-devtools/docs/focus-trap');
  });

  it('lowers the impact when Shift+Tab escapes', () => {
    document.body.innerHTML = `<textarea id="editor"></textarea>`;
    const walk = createFocusWalkProbe(document);
    focus('editor');
    const id = walk.probe().id!;

    const finding = walk.trapFinding([id], true);
    expect(finding!.impact).toBe('moderate');
    expect(finding!.target).toBe('textarea#editor');
    expect(finding!.help).toContain('focus stays on this element');
  });

  it('does not report focus cycling inside an open aria-modal (containment is correct)', () => {
    document.body.innerHTML = `
      <div id="dlg" role="dialog" aria-modal="true">
        <button id="ok">OK</button><button id="cancel">Cancel</button>
      </div>
    `;
    const walk = createFocusWalkProbe(document);
    focus('ok');
    const ok = walk.probe().id!;
    focus('cancel');
    const cancel = walk.probe().id!;

    expect(walk.trapFinding([ok, cancel], false)).toBeNull();
  });
});
