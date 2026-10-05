/**
 * What marks an element as showing content on hover: a tooltip directive from a
 * known library, an Angular hover listener, or a native `title` on an icon. The
 * keyboard scan reports such an element when Tab can't reach it, since keyboard
 * users then never see that content (`ngbr/hover-only-content`).
 *
 * Tooltip libraries attach their mouse listeners with `addEventListener`, which
 * Angular's `getListeners` can't see, so each library is recognised by its
 * directive class (dev builds) or by a DOM marker that's there in production
 * too: a host class, or the attribute Angular renders for a static input
 * (`matTooltip="Info"` → `mattooltip="Info"`).
 */
import { resolveDirectives } from '../attribution.js';

interface TooltipLibrary {
  /** Directive class names that are unambiguous on their own. */
  directives: readonly string[];
  /** Common class names that count only with a marker or one of `instanceKeys`. */
  genericDirectives?: readonly string[];
  /** Properties a generic directive's instance has in this library. */
  instanceKeys?: readonly string[];
  /** DOM markers, present in production builds too. */
  selector: string;
  /** A marker attribute whose value is the tooltip text: empty means no tooltip. */
  textAttribute?: string;
  /** A marker that a web component could use for something else: skip it on custom elements. */
  genericMarker?: boolean;
  /** The tooltip is switched off, or has no text (dev builds, from the directive instance). */
  isOff?: (instance: Record<string, unknown>) => boolean;
}

const empty = (value: unknown) => value == null || String(value).trim() === '';

/** Tooltip directives we recognise. Popovers are left out: most open on click. */
const TOOLTIP_LIBRARIES: readonly TooltipLibrary[] = [
  // Angular Material
  {
    directives: ['MatTooltip'],
    selector: '.mat-mdc-tooltip-trigger, [mattooltip]',
    textAttribute: 'mattooltip',
    isOff: (d) => d['disabled'] === true || empty(d['message']),
  },
  // PrimeNG
  {
    directives: [],
    genericDirectives: ['Tooltip'],
    instanceKeys: ['tooltipPosition'],
    selector: '[ptooltip]',
    textAttribute: 'ptooltip',
    isOff: (d) => d['tooltipDisabled'] === true || d['disabled'] === true,
  },
  // ng-bootstrap
  {
    directives: ['NgbTooltip'],
    selector: '[ngbtooltip]',
    textAttribute: 'ngbtooltip',
    isOff: (d) => d['disableTooltip'] === true || empty(d['ngbTooltip']),
  },
  // ngx-bootstrap
  {
    directives: [],
    genericDirectives: ['TooltipDirective'],
    instanceKeys: ['tooltip'],
    selector: '[tooltip]',
    textAttribute: 'tooltip',
    genericMarker: true,
    isOff: (d) => d['isDisabled'] === true || empty(d['tooltip']),
  },
  // ng-zorro
  { directives: ['NzTooltipDirective'], selector: '[nz-tooltip]' },
  // Taiga UI
  { directives: ['TuiHint', 'TuiHintDirective', 'TuiHintHover'], selector: '[tuihint]', textAttribute: 'tuihint' },
  // @ngneat/helipopper (Tippy.js)
  { directives: ['TippyDirective'], selector: '[tp]', textAttribute: 'tp', genericMarker: true },
  // HTML interest invokers
  { directives: [], selector: '[interestfor]' },
];

/** Every marker in one selector, so most elements cost a single `matches()`. */
const ANY_MARKER = TOOLTIP_LIBRARIES.map((lib) => lib.selector).join(', ');

const HOVER_EVENTS = ['mouseenter', 'mouseover', 'pointerenter', 'pointerover'];

/**
 * Icon-font classes whose text is a ligature or glyph name, not visible text:
 * Material Icons and Symbols, Font Awesome, Bootstrap Icons, PrimeIcons, Glyphicons.
 */
const ICON_CLASS = /^(mat-icon|material-icons|material-symbols-\w+|fa-[\w-]+|fa[srlbdt]|fa-solid|fa-regular|bi-[\w-]+|pi-[\w-]+|glyphicon-[\w-]+)$/;

/** How an element shows content on hover. */
export type HoverSignal = 'tooltip' | 'hover-listener' | 'title';

/**
 * True when a tooltip from a known library is on `element` and switched on. A
 * dev build answers from the directive instance; otherwise from the markers.
 */
function hasTooltip(element: Element): boolean {
  let marked = false;
  try {
    marked = element.matches(ANY_MARKER);
  } catch {
    marked = false; // a selector this DOM implementation can't parse
  }
  // Material marks a tooltip that's switched off; this works in production too.
  if (marked && element.classList.contains('mat-mdc-tooltip-disabled')) return false;

  const directives = resolveDirectives(element);
  for (const lib of TOOLTIP_LIBRARIES) {
    const found = directives.find(
      (d) =>
        lib.directives.includes(d.name) ||
        (lib.genericDirectives?.includes(d.name) &&
          (safeMatches(element, lib.selector) || (lib.instanceKeys ?? []).some((key) => key in d.instance))),
    );
    if (found) {
      if (!lib.isOff?.(found.instance as Record<string, unknown>)) return true;
      continue;
    }
    if (!marked || !safeMatches(element, lib.selector)) continue;
    // A marker with no directive: production, or something else using the attribute.
    if (directives.length > 0 && lib.directives.length + (lib.genericDirectives?.length ?? 0) > 0) continue;
    if (lib.genericMarker && element.tagName.includes('-')) continue;
    if (lib.textAttribute && element.hasAttribute(lib.textAttribute) && empty(element.getAttribute(lib.textAttribute))) {
      continue;
    }
    return true;
  }
  return false;
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/**
 * True when `element` shows no text of its own: no text content, an `<svg>` or
 * `<img>`, or an icon-font element whose text is a ligature (`<mat-icon>info</mat-icon>`).
 */
export function isIconLike(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'svg' || tag === 'img' || tag === 'mat-icon') return true;
  if ([...element.classList].some((c) => ICON_CLASS.test(c))) return true;
  return (element.textContent ?? '').trim() === '';
}

/** A `title` that adds nothing to the element's `alt` or `aria-label`. */
function titleRepeatsName(element: Element, title: string): boolean {
  const norm = (v: string | null) => (v ?? '').trim().toLowerCase();
  return [element.getAttribute('alt'), element.getAttribute('aria-label')].some((n) => norm(n) === norm(title));
}

/**
 * The strongest hover signal on `element`: a tooltip that's switched on, then an
 * Angular hover listener, then a `title` on an icon. `events` are the Angular
 * listener names on it (see `resolveListenerEvents`), passed in so a scan reads
 * them once.
 */
export function hoverSignal(element: Element, events: readonly string[]): HoverSignal | null {
  if (hasTooltip(element)) return 'tooltip';
  if (events.some((e) => HOVER_EVENTS.includes(e.split('.')[0]))) return 'hover-listener';
  const title = (element.getAttribute('title') ?? '').trim();
  if (title !== '' && isIconLike(element) && !titleRepeatsName(element, title)) return 'title';
  return null;
}
