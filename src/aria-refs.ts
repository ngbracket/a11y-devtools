import { appComponentFromPath, DEFAULT_FRAMEWORK_PREFIXES, resolveComponentPath, resolveDirectiveNames } from './attribution.js';
import { RULE_DOCS, shortHtml, shortSelector, uniqueLocator } from './keyboard/keyboard-scan.js';
import { isHidden } from './keyboard/tab-sequence.js';
import { OVERLAY_EXCLUDE_SELECTOR } from './overlay.js';
import type { A11yFinding, Impact } from './scan.js';

export const MISSING_ID_RULE = 'ngbr/missing-id-reference';

/**
 * The attributes checked, with what a missing id costs. axe-core's
 * `aria-valid-attr-value` lists these as "needs review" when no id exists and
 * passes them when at least one does, so neither case reaches its violations.
 * `aria-controls` and `aria-owns` aren't here: axe already fails them when they
 * point nowhere and the relationship is in use.
 */
const ATTRIBUTES = {
  'aria-labelledby': {
    wcag: ['4.1.2'],
    all: 'serious',
    some: 'moderate',
    allEffect: 'so the element gets no name from it',
    someEffect: 'so part of the name is missing',
  },
  'aria-describedby': {
    wcag: ['1.3.1'],
    all: 'moderate',
    some: 'minor',
    allEffect: 'so the element gets no description from it',
    someEffect: 'so part of the description is missing',
  },
} as const satisfies Record<
  string,
  { wcag: readonly string[]; all: Impact; some: Impact; allEffect: string; someEffect: string }
>;

type CheckedAttribute = keyof typeof ATTRIBUTES;

/** The element an id refers to, looked up where the browser looks: the element's own document or shadow root. */
function byId(element: Element, id: string): Element | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  return typeof root.getElementById === 'function' ? root.getElementById(id) : null;
}

/**
 * One `ngbr/missing-id-reference` finding per `aria-labelledby` or
 * `aria-describedby` on a shown element under `root` that names an id with no
 * element. Certain, not a heuristic: the id is either in the page or it isn't.
 * Impact is higher when none of the ids exist (nothing of the name or
 * description is left) than when only some are missing.
 */
export function scanMissingIdReferences(
  root: ParentNode = document,
  options: { frameworkPrefixes?: readonly string[] } = {},
): A11yFinding[] {
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  const findings: A11yFinding[] = [];
  const selector = Object.keys(ATTRIBUTES).map((a) => `[${a}]`).join(', ');
  for (const element of root.querySelectorAll(selector)) {
    if (element.closest(OVERLAY_EXCLUDE_SELECTOR) || isHidden(element)) continue;
    for (const attribute of Object.keys(ATTRIBUTES) as CheckedAttribute[]) {
      const ids = (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
      const missing = ids.filter((id) => !byId(element, id));
      if (!missing.length) continue;
      const rule = ATTRIBUTES[attribute];
      const none = missing.length === ids.length;
      const quoted = missing.map((id) => `"${id}"`).join(', ');
      const componentPath = resolveComponentPath(element);
      findings.push({
        id: MISSING_ID_RULE,
        impact: none ? rule.all : rule.some,
        help:
          `${attribute} refers to ${missing.length === 1 ? 'an id' : 'ids'} with no element in the page ` +
          `(${quoted}), ${none ? rule.allEffect : rule.someEffect}. ` +
          `Give the element it should point to ${missing.length === 1 ? 'that id' : 'those ids'}, or fix the reference.`,
        helpUrl: `${RULE_DOCS}/missing-id-reference`,
        wcag: [...rule.wcag],
        component: appComponentFromPath(componentPath, prefixes),
        componentPath,
        directives: resolveDirectiveNames(element),
        // With the attribute, so a broken labelledby and describedby on one element stay two findings in a baseline.
        target: `${shortSelector(element)}[${attribute}]`,
        locator: uniqueLocator(element),
        html: shortHtml(element),
      });
    }
  }
  return findings;
}
