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
import { resolveDirectives, resolveListenerEvents } from '../attribution.js';

interface TooltipLibrary {
  /** Directive class names that are unambiguous on their own. */
  directives: readonly string[];
  /** Common class names that count only with a marker or one of `instanceKeys`. */
  genericDirectives?: readonly string[];
  /** Properties a generic directive's instance has in this library. */
  instanceKeys?: readonly string[];
  /** DOM markers, present in production builds too. */
  selector: string;
}

/** Tooltip directives we recognise. Popovers are left out: most open on click. */
const TOOLTIP_LIBRARIES: readonly TooltipLibrary[] = [
  // Angular Material
  { directives: ['MatTooltip'], selector: '.mat-mdc-tooltip-trigger, [mattooltip]' },
  // PrimeNG
  { directives: [], genericDirectives: ['Tooltip'], instanceKeys: ['tooltipPosition'], selector: '[ptooltip]' },
  // ng-bootstrap
  { directives: ['NgbTooltip'], selector: '[ngbtooltip]' },
  // ngx-bootstrap
  { directives: [], genericDirectives: ['TooltipDirective'], instanceKeys: ['tooltip'], selector: '[tooltip]' },
  // ng-zorro
  { directives: ['NzTooltipDirective'], selector: '[nz-tooltip]' },
  // Taiga UI
  { directives: ['TuiHint', 'TuiHintDirective', 'TuiHintHover'], selector: '[tuihint]' },
  // @ngneat/helipopper (Tippy.js)
  { directives: ['TippyDirective'], selector: '[tp]' },
  // HTML interest invokers
  { directives: [], selector: '[interestfor]' },
];

const HOVER_EVENTS = ['mouseenter', 'mouseover', 'pointerenter', 'pointerover'];

/** Icon-font classes whose text is a ligature or glyph name, not visible text. */
const ICON_CLASS = /^(mat-icon|material-icons|material-symbols|fa[a-z]?|bi|pi|glyphicon)(-|$)/;

/** How an element shows content on hover, or null when nothing says it does. */
export type HoverSignal = 'tooltip' | 'hover-listener' | 'title';

function tooltipDirective(element: Element): boolean {
  const directives = resolveDirectives(element);
  return TOOLTIP_LIBRARIES.some(
    (lib) =>
      directives.some((d) => lib.directives.includes(d.name)) ||
      directives.some(
        (d) =>
          lib.genericDirectives?.includes(d.name) &&
          (element.matches(lib.selector) || (lib.instanceKeys ?? []).some((key) => key in d.instance)),
      ),
  );
}

function tooltipMarker(element: Element): boolean {
  return TOOLTIP_LIBRARIES.some((lib) => {
    try {
      return element.matches(lib.selector);
    } catch {
      return false; // a selector this DOM implementation can't parse
    }
  });
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

/**
 * The strongest hover signal on `element`: a tooltip directive or marker, then
 * an Angular hover listener, then a non-empty `title` on an icon.
 */
export function hoverSignal(element: Element): HoverSignal | null {
  if (tooltipMarker(element) || tooltipDirective(element)) return 'tooltip';
  const events = resolveListenerEvents(element).map((e) => e.split('.')[0]);
  if (events.some((e) => HOVER_EVENTS.includes(e))) return 'hover-listener';
  if ((element.getAttribute('title') ?? '').trim() !== '' && isIconLike(element)) return 'title';
  return null;
}
