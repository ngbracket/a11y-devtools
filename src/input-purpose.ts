import { appComponentFromPath, DEFAULT_FRAMEWORK_PREFIXES, resolveComponentPath, resolveDirectiveNames } from './attribution.js';
import { RULE_DOCS, shortHtml, shortSelector, uniqueLocator } from './keyboard/keyboard-scan.js';
import { isHidden } from './keyboard/tab-sequence.js';
import { OVERLAY_EXCLUDE_SELECTOR } from './overlay.js';
import type { A11yFinding } from './scan.js';

export const MISSING_AUTOCOMPLETE_RULE = 'ngbr/missing-autocomplete';

/**
 * WCAG 1.3.5 input purposes the check looks for, in the order they're tried, and
 * the words that name them. Matched against whole words of the field's label,
 * then its `name`, `id` or `formcontrolname` split into words, then its
 * placeholder. Kept to words that rarely mean anything else on a form: plain
 * "name", "address", "title" and "state" are left out on purpose.
 */
const PURPOSES: readonly { purpose: string; what: string; words: RegExp }[] = [
  { purpose: 'email', what: 'email address', words: /\b(e ?mail|email address)\b/ },
  { purpose: 'given-name', what: 'first name', words: /\b(first ?name|forename|given name|fname)\b/ },
  { purpose: 'family-name', what: 'last name', words: /\b(last ?name|surname|family name|lname)\b/ },
  { purpose: 'name', what: 'name', words: /^(your |full )?name$/ },
  { purpose: 'tel', what: 'phone number', words: /\b(tel|telephone|phone|mobile|cell ?phone)\b/ },
  { purpose: 'postal-code', what: 'postcode', words: /\b(post ?code|postal code|zip|zip ?code)\b/ },
  { purpose: 'address-line1', what: 'first address line', words: /\baddress (line )?1\b/ },
  { purpose: 'address-line2', what: 'second address line', words: /\baddress (line )?2\b/ },
  { purpose: 'address-line3', what: 'third address line', words: /\baddress (line )?3\b/ },
  { purpose: 'street-address', what: 'street address', words: /\bstreet address\b/ },
  { purpose: 'address-level2', what: 'town or city', words: /\b(town|city)\b/ },
  { purpose: 'address-level1', what: 'county', words: /\b(county|province)\b/ },
  { purpose: 'country-name', what: 'country', words: /\bcountry\b/ },
  { purpose: 'bday', what: 'date of birth', words: /\b(date of birth|birth ?date|dob|birthday)\b/ },
  { purpose: 'organization', what: 'organisation', words: /\b(company|organi[sz]ation)\b/ },
  { purpose: 'username', what: 'username', words: /\buser ?name\b/ },
];

/** Purposes found from the input type alone. */
const BY_TYPE: Readonly<Record<string, { purpose: string; what: string }>> = {
  email: { purpose: 'email', what: 'email address' },
  tel: { purpose: 'tel', what: 'phone number' },
  password: { purpose: 'current-password', what: 'password' },
};

/** Input types that never collect one of these purposes, or that the browser fills in its own way. */
const SKIPPED_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'search', 'submit',
]);

/** Text as lowercase words: `addressLine1` → `address line 1`, `post_code` → `post code`. */
function words(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The field's label text: `aria-labelledby`, `aria-label`, then its `<label>`s. */
function labelText(field: HTMLElement): string {
  const root = field.getRootNode() as Document | ShadowRoot;
  const ids = (field.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const byIds = ids.map((id) => root.getElementById?.(id)?.textContent ?? '').join(' ').trim();
  if (byIds) return byIds;
  const aria = field.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  const labels = (field as HTMLInputElement).labels;
  return labels ? [...labels].map((l) => l.textContent ?? '').join(' ').trim() : '';
}

/**
 * The purpose a field's text points to, and the text that matched; undefined
 * when nothing matches or the sources disagree with each other.
 */
export function inputPurpose(field: HTMLElement): { purpose: string; what: string; from: string } | undefined {
  const type = (field.getAttribute('type') ?? '').toLowerCase();
  if (BY_TYPE[type]) return { ...BY_TYPE[type], from: `type="${type}"` };
  const label = labelText(field);
  const sources: { text: string; from: string; decides?: boolean }[] = [
    { text: label, from: `the label "${label.slice(0, 60)}"`, decides: true },
    ...['name', 'id', 'formcontrolname'].map((a) => {
      const value = field.getAttribute(a) ?? '';
      return { text: value, from: `${a}="${value.slice(0, 60)}"` };
    }),
    { text: field.getAttribute('placeholder') ?? '', from: `the placeholder "${(field.getAttribute('placeholder') ?? '').slice(0, 60)}"` },
  ];
  for (const source of sources) {
    const text = words(source.text);
    if (!text) continue;
    // A lookup box ("Find your address", "Search by postcode") isn't the field the value is kept in.
    if (/\b(search|find|look ?up)\b/.test(text)) return undefined;
    // "Last name, First name" in one field is the whole name.
    const matches = PURPOSES.filter((p) => p.words.test(text));
    const both = matches.some((p) => p.purpose === 'given-name') && matches.some((p) => p.purpose === 'family-name');
    const match = both ? PURPOSES.find((p) => p.purpose === 'name') : matches[0];
    if (match) return { purpose: match.purpose, what: match.what, from: source.from };
    // A label that names something else (for example "Promo code") decides it: don't look further.
    if (source.decides) return undefined;
  }
  return undefined;
}

function isCandidate(element: Element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const tag = element.tagName.toLowerCase();
  if (tag === 'input') return !SKIPPED_TYPES.has((element.getAttribute('type') ?? 'text').toLowerCase());
  return tag === 'select' || tag === 'textarea';
}

/**
 * One `ngbr/missing-autocomplete` finding per form field under `root` that
 * looks like it asks for one of WCAG 1.3.5's input purposes (name, email,
 * phone, address and so on) and has no `autocomplete` attribute. A heuristic:
 * the field may ask about someone other than the user, which 1.3.5 doesn't
 * cover. A field with any `autocomplete` value, `off` included, is left to
 * axe's `autocomplete-valid`.
 */
export function scanMissingAutocomplete(
  root: ParentNode = document,
  options: { frameworkPrefixes?: readonly string[] } = {},
): A11yFinding[] {
  const prefixes = options.frameworkPrefixes ?? DEFAULT_FRAMEWORK_PREFIXES;
  const fields = [...root.querySelectorAll('input, select, textarea')];
  if (root instanceof Element && root.matches('input, select, textarea')) fields.unshift(root);
  const findings: A11yFinding[] = [];
  for (const field of fields) {
    if (!isCandidate(field) || field.hasAttribute('autocomplete')) continue;
    if (field.disabled || field.hasAttribute('readonly') || field.getAttribute('aria-readonly') === 'true') continue;
    if (field.closest(OVERLAY_EXCLUDE_SELECTOR) || field.closest('[role="search"], search') || isHidden(field)) continue;
    const match = inputPurpose(field);
    if (!match) continue;
    const componentPath = resolveComponentPath(field);
    const suggestion =
      match.purpose === 'current-password'
        ? 'autocomplete="current-password" (or "new-password" on a sign-up form)'
        : `autocomplete="${match.purpose}"`;
    findings.push({
      id: MISSING_AUTOCOMPLETE_RULE,
      impact: 'moderate',
      help:
        `This field looks like it asks for the user's own ${match.what} (from ${match.from}), ` +
        `but it has no autocomplete attribute. Add ${suggestion} so browsers can fill it in and ` +
        `assistive tools can tell what it's for. If it asks about someone else, it doesn't need one. ` +
        `Heuristic — verify manually.`,
      helpUrl: `${RULE_DOCS}/missing-autocomplete`,
      wcag: ['1.3.5'],
      component: appComponentFromPath(componentPath, prefixes),
      componentPath,
      directives: resolveDirectiveNames(field),
      target: shortSelector(field),
      locator: uniqueLocator(field),
      html: shortHtml(field),
    });
  }
  return findings;
}
