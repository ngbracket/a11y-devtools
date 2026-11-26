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

/** Roles, and elements with those roles by default, whose name can come from their text. */
const NAME_FROM_CONTENT_ROLES = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab',
  'tooltip', 'treeitem',
]);
const NAME_FROM_CONTENT_TAGS = new Set(['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'option', 'summary', 'td', 'th']);

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The name an element still gets when its `aria-labelledby` resolves to
 * nothing: browsers then ignore the attribute and fall back to `aria-label`, a
 * native `<label>`, `alt`, `title`, or for buttons, links and the like, the text
 * inside. A close approximation of the accname steps, enough to tell "no name
 * left" from "named another way". Empty when there's none.
 */
function fallbackName(element: Element): string {
  const ariaLabel = clean(element.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;
  const labels = (element as HTMLInputElement).labels;
  if (labels?.length) {
    const text = clean([...labels].map((l) => l.textContent).join(' '));
    if (text) return text;
  }
  const alt = clean(element.getAttribute('alt'));
  if (alt && element.tagName.toLowerCase() === 'img') return alt;
  const role = (element.getAttribute('role') ?? '').trim().split(/\s+/)[0];
  const fromContent = role ? NAME_FROM_CONTENT_ROLES.has(role) : NAME_FROM_CONTENT_TAGS.has(element.tagName.toLowerCase());
  if (fromContent) {
    const text = clean(element.textContent);
    if (text) return text;
  }
  return clean(element.getAttribute('title'));
}

/** Every element under `root`, and `root` itself when it's an element, that matches `selector`, through open shadow roots. */
function queryDeep(root: ParentNode, selector: string): Element[] {
  const found: Element[] = [];
  if (root instanceof Element && root.matches(selector)) found.push(root);
  const visit = (scope: ParentNode) => {
    for (const element of scope.querySelectorAll('*')) {
      if (element.matches(selector)) found.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  if (root instanceof Element && root.shadowRoot) visit(root.shadowRoot);
  visit(root);
  return found;
}

/** The element an id refers to, looked up where the browser looks: the element's own document or shadow root. */
function byId(element: Element, id: string): Element | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  return root.getElementById(id);
}

/** True when the element is in a document or a shadow root, where ids can be looked up. */
function inTree(element: Element): boolean {
  return typeof (element.getRootNode() as Partial<Document>).getElementById === 'function';
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
  for (const element of queryDeep(root, selector)) {
    if (!inTree(element) || element.closest(OVERLAY_EXCLUDE_SELECTOR) || isHidden(element)) continue;
    for (const attribute of Object.keys(ATTRIBUTES) as CheckedAttribute[]) {
      const ids = (element.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean);
      const missing = ids.filter((id) => !byId(element, id));
      if (!missing.length) continue;
      const rule = ATTRIBUTES[attribute];
      const none = missing.length === ids.length;
      // With no id left, browsers ignore aria-labelledby and name the element another way, if there is one.
      const otherName = none && attribute === 'aria-labelledby' ? fallbackName(element) : '';
      const quoted = missing.map((id) => `"${id}"`).join(', ');
      const componentPath = resolveComponentPath(element);
      findings.push({
        id: MISSING_ID_RULE,
        impact: otherName ? 'minor' : none ? rule.all : rule.some,
        help:
          `${attribute} refers to ${missing.length === 1 ? 'an id' : 'ids'} with no element in the page ` +
          `(${quoted}), ` +
          (otherName
            ? `so browsers ignore it and name the element another way ("${otherName.slice(0, 60)}"). `
            : `${none ? rule.allEffect : rule.someEffect}. `) +
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
