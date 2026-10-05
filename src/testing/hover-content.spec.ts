import { afterEach, describe, expect, it } from 'vitest';
import { RULE_DOCS, scanKeyboard, shortSelector } from '../keyboard/keyboard-scan';
import { hoverSignal, isIconLike } from '../keyboard/hover-content';

/** A directive instance whose class is called `name`, with extra own properties. */
function directive(name: string, props: Record<string, unknown> = {}): object {
  const cls = { [name]: class {} }[name];
  return Object.assign(new cls(), props);
}

/**
 * Install a fake `window.ng`: `listeners` maps an element to the DOM events
 * Angular bound on it, `directives` to the directive instances on it.
 */
function withNg(
  fn: () => void,
  listeners: Map<Element, string[]> = new Map(),
  directives: Map<Element, object[]> = new Map(),
): void {
  const original = (globalThis as { ng?: unknown }).ng;
  (globalThis as { ng?: unknown }).ng = {
    getComponent: () => null,
    getOwningComponent: () => null,
    getDirectives: (el: Element) => directives.get(el) ?? [],
    getListeners: (el: Element) => (listeners.get(el) ?? []).map((name) => ({ name, type: 'dom' as const })),
  };
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

const hover = (host: ParentNode) => scanKeyboard(host).filter((f) => f.id === 'ngbr/hover-only-content');

describe('ngbr/hover-only-content', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('tooltip libraries, by DOM marker', () => {
    const markers: [string, string][] = [
      ['Angular Material (static input)', '<mat-icon mattooltip="Info">info</mat-icon>'],
      ['Angular Material (host class)', '<mat-icon class="mat-mdc-tooltip-trigger">info</mat-icon>'],
      ['PrimeNG', '<i class="pi pi-info" ptooltip="Info"></i>'],
      ['ng-bootstrap', '<span ngbtooltip="Info">?</span>'],
      ['ngx-bootstrap', '<span tooltip="Info">?</span>'],
      ['ng-zorro', '<span nz-tooltip nztooltiptitle="Info">?</span>'],
      ['Taiga UI', '<span tuihint="Info">?</span>'],
      ['helipopper', '<span tp="Info">?</span>'],
      ['interest invokers', '<span interestfor="tip">?</span><div id="tip" popover>Info</div>'],
    ];
    for (const [library, html] of markers) {
      it(`flags ${library}`, () => {
        const found = hover(fixture(html));
        expect(found).toHaveLength(1);
        expect(found[0].impact).toBe('moderate');
        expect(found[0].helpUrl).toBe(`${RULE_DOCS}/hover-only-content`);
      });
    }
  });

  describe('tooltip libraries, by directive (bound input, no marker)', () => {
    it('flags MatTooltip, NgbTooltip, NzTooltipDirective, TuiHint and TippyDirective', () => {
      const host = fixture(['a', 'b', 'c', 'd', 'e'].map((id) => `<span id="${id}">?</span>`).join(''));
      const names = ['MatTooltip', 'NgbTooltip', 'NzTooltipDirective', 'TuiHint', 'TippyDirective'];
      const dirs = new Map(names.map((name, i) => [host.children[i], [directive(name)]]));
      withNg(() => expect(hover(host).map((f) => f.target)).toEqual(['span#a', 'span#b', 'span#c', 'span#d', 'span#e']), new Map(), dirs);
    });

    it('counts a generic class name only with the library’s own instance property', () => {
      const host = fixture('<span id="prime">?</span><span id="kendo">?</span><span id="ngx">?</span>');
      const [prime, kendo, ngx] = [...host.children];
      const dirs = new Map<Element, object[]>([
        [prime, [directive('Tooltip', { tooltipPosition: 'right' })]],
        [kendo, [directive('TooltipDirective', { filter: '[title]' })]],
        [ngx, [directive('TooltipDirective', { tooltip: 'Info' })]],
      ]);
      withNg(() => expect(hover(host).map((f) => f.target)).toEqual(['span#prime', 'span#ngx']), new Map(), dirs);
    });
  });

  it('flags an element with an Angular hover listener', () => {
    const host = fixture('<span id="hint">?</span>');
    withNg(() => expect(hover(host)).toHaveLength(1), new Map([[host.firstElementChild!, ['mouseenter', 'mouseleave']]]));
  });

  describe('title', () => {
    it('flags a title on an icon as minor', () => {
      const found = hover(fixture('<mat-icon title="Mandatory">error</mat-icon><span class="dot" title="Expired"></span>'));
      expect(found.map((f) => f.impact)).toEqual(['minor', 'minor']);
    });

    it('ignores a title on text', () => {
      expect(hover(fixture('<abbr title="Web Content Accessibility Guidelines">WCAG</abbr>'))).toEqual([]);
    });

    it('treats icon-font ligatures as icons', () => {
      const host = fixture('<span class="material-symbols-outlined">info</span><span>Info</span>');
      expect(isIconLike(host.children[0])).toBe(true);
      expect(isIconLike(host.children[1])).toBe(false);
    });
  });

  describe('not flagged', () => {
    it('when Tab reaches the trigger', () => {
      expect(hover(fixture('<span tabindex="0" mattooltip="Info">?</span><button mattooltip="Info">Save</button>'))).toEqual([]);
    });

    it('when the trigger is hidden', () => {
      expect(hover(fixture('<span hidden mattooltip="Info">?</span>'))).toEqual([]);
    });

    it('when it wraps something Tab reaches', () => {
      expect(hover(fixture('<span mattooltip="Info"><button>Save</button></span>'))).toEqual([]);
    });

    it('when it sits inside something Tab reaches, such as an icon in a link', () => {
      expect(hover(fixture('<a href="/x">Course <mat-icon title="Opens in a new tab">open_in_new</mat-icon></a>'))).toEqual([]);
    });

    it('when an ancestor was already reported', () => {
      const found = hover(fixture('<span mattooltip="Info"><mat-icon title="Info">info</mat-icon></span>'));
      expect(found).toHaveLength(1);
      expect(found[0].target).toBe('span');
    });

    it('when it is behind an open modal dialog', () => {
      const host = fixture('<span mattooltip="Behind">?</span><dialog open data-modal><span mattooltip="Inside">?</span></dialog>');
      const found = scanKeyboard(host, { isModal: (el) => el.hasAttribute('data-modal') }).filter(
        (f) => f.id === 'ngbr/hover-only-content',
      );
      expect(found.map((f) => f.html)).toEqual(['<span mattooltip="Inside">?</span>']);
    });

    it('when the element is already an unreachable control', () => {
      const host = fixture('<span role="button" mattooltip="Delete">x</span>');
      const ids = scanKeyboard(host).map((f) => f.id);
      expect(ids).toEqual(['ngbr/unreachable-control']);
    });

    it('for the devtools overlay itself', () => {
      expect(hover(fixture('<div data-ngb-a11y-overlay><span mattooltip="x">?</span></div>'))).toEqual([]);
    });
  });

  it('flags a disabled button with a tooltip, suggesting aria-disabled', () => {
    const found = hover(fixture('<button disabled mattooltip="Finish the form first">Submit</button>'));
    expect(found).toHaveLength(1);
    expect(found[0].help).toContain('aria-disabled="true"');
  });

  it('flags only the unreachable icons in repeated rows, each on its own element', () => {
    const row = (focusable: boolean) =>
      `<tr><td><a href="/c">Course</a> <mat-icon class="info"${focusable ? ' tabindex="0"' : ''} mattooltip="Details">info</mat-icon></td><td>Not set</td></tr>`;
    const host = fixture(`<table id="reqs"><tbody>${row(true)}${row(false)}${row(false)}</tbody></table>`);
    const found = hover(host);
    expect(found).toHaveLength(2);
    const icons = [...host.querySelectorAll('mat-icon')];
    expect(found.map((f) => document.querySelector(f.target))).toEqual([icons[1], icons[2]]);
  });
});

describe('hoverSignal', () => {
  it('prefers a tooltip over a title', () => {
    const el = fixture('<mat-icon mattooltip="A" title="B">info</mat-icon>').firstElementChild!;
    expect(hoverSignal(el)).toBe('tooltip');
  });

  it('returns null with no signal', () => {
    expect(hoverSignal(fixture('<span>Text</span>').firstElementChild!)).toBeNull();
  });
});

describe('shortSelector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the short form when it is unique', () => {
    const el = fixture('<div id="only" class="a b">x</div>').firstElementChild!;
    expect(shortSelector(el)).toBe('div#only');
  });

  it('builds an nth-child path for a repeated element, from the nearest unique id', () => {
    const host = fixture('<ul id="list"><li><i class="ic">a</i></li><li><i class="ic">b</i></li></ul>');
    const second = host.querySelectorAll('i')[1];
    const selector = shortSelector(second);
    expect(selector).toBe('ul#list > li:nth-child(2) > i.ic:nth-child(1)');
    expect(document.querySelector(selector)).toBe(second);
  });

  it('falls back to a path from body when no ancestor has an id', () => {
    const host = fixture('<p><b>x</b></p><p><b>y</b></p>');
    const second = host.querySelectorAll('b')[1];
    expect(document.querySelector(shortSelector(second))).toBe(second);
  });
});
