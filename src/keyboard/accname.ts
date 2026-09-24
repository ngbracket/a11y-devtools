/**
 * The keyboard layer, part C: a *computed approximation* of what assistive tech
 * would announce for an element — its role, accessible name, description, and
 * ARIA states.
 *
 * HONESTY GUARDRAIL (non-negotiable): this is a computed approximation, NEVER
 * "what a screen reader says". Real output varies by screen reader
 * (NVDA/JAWS/VoiceOver), browse vs. focus mode, verbosity, and browser. Callers
 * must label it as such and must not brand it as any specific SR's output.
 *
 * The name and role come from **axe-core's own accessible-name commons** — the
 * same well-tested implementation the scan already relies on — so there's one
 * accname source, not a second home-grown one. axe is loaded via dynamic import
 * (and only when this runs), so it never enters a consumer's static bundle; the
 * prod-weight guard still holds.
 */

/** A computed approximation of an element's accessibility-tree node. */
export interface AxDescription {
  /** Computed ARIA role, or null when axe can't resolve one. */
  role: string | null;
  /** Computed accessible name (may be empty — itself a finding worth noticing). */
  name: string;
  /** Computed accessible description (aria-describedby / title), or ''. */
  description: string;
  /** Compact human labels for the element's states, e.g. `['expanded', 'level 2']`. */
  states: string[];
}

/** Minimal shape of the axe internals this module uses (not in axe's public types). */
interface AxeCommons {
  setup(root: Document | Element): unknown;
  teardown(): unknown;
  utils: { getNodeFromTree(node: Element): unknown };
  commons: {
    aria: { getRole(node: Element): string | null };
    text: { accessibleTextVirtual(vnode: unknown): string };
  };
}

// axe is a heavy dynamic import; load it once and reuse. Typed loosely because
// the accname commons used here aren't part of axe's published type surface.
let axePromise: Promise<AxeCommons> | undefined;
function loadAxe(): Promise<AxeCommons> {
  return (axePromise ??= import('axe-core').then(
    (m) => ((m as { default?: unknown }).default ?? m) as unknown as AxeCommons,
  ));
}

/**
 * Compute the accessibility-tree approximation for `element`. Resolves to sane
 * defaults (no role, empty name) rather than throwing if axe's tree can't be
 * built — e.g. a scan is mid-flight — so a focus-follow caller degrades quietly.
 */
export async function describeElement(element: Element): Promise<AxDescription> {
  const axe = await loadAxe();
  const doc = element.ownerDocument ?? document;
  let role: string | null = null;
  let name = '';
  try {
    axe.setup(doc);
    const vnode = axe.utils.getNodeFromTree(element);
    role = axe.commons.aria.getRole(element) ?? null;
    name = vnode ? (axe.commons.text.accessibleTextVirtual(vnode) ?? '') : '';
  } catch {
    // Leave role=null / name='' — axe couldn't build a tree (e.g. run in flight).
  } finally {
    try {
      axe.teardown();
    } catch {
      /* nothing set up */
    }
  }
  return { role, name, description: accessibleDescription(element), states: ariaStates(element) };
}

/** The accessible description: `aria-describedby` targets' text, else the `title`. */
export function accessibleDescription(element: Element): string {
  const ids = element.getAttribute('aria-describedby');
  if (ids) {
    const doc = element.ownerDocument ?? document;
    const text = ids
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }
  return element.getAttribute('title')?.trim() ?? '';
}

/** True for an ARIA attribute value that expresses "on" rather than "off"/absent. */
function isOn(value: string | null): boolean {
  return value !== null && value !== 'false' && value !== 'undefined';
}

/**
 * Compact, human-readable state labels — the states a screen reader would voice
 * alongside role and name (expanded, checked, disabled, current, level, position
 * in set). ARIA attributes take precedence, with native fallbacks (a real
 * checkbox's `checked`, a disabled control, a heading's level).
 */
export function ariaStates(element: Element): string[] {
  const states: string[] = [];
  const attr = (name: string) => element.getAttribute(name);

  const expanded = attr('aria-expanded');
  if (expanded === 'true') states.push('expanded');
  else if (expanded === 'false') states.push('collapsed');

  const checked = attr('aria-checked');
  if (checked === 'true') states.push('checked');
  else if (checked === 'false') states.push('not checked');
  else if (checked === 'mixed') states.push('mixed');
  else if ('checked' in element && (element as HTMLInputElement).checked) states.push('checked');

  const pressed = attr('aria-pressed');
  if (pressed === 'true') states.push('pressed');
  else if (pressed === 'false') states.push('not pressed');

  if (attr('aria-selected') === 'true') states.push('selected');

  if (isOn(attr('aria-disabled')) || ('disabled' in element && (element as HTMLInputElement).disabled)) {
    states.push('disabled');
  }
  if (isOn(attr('aria-required')) || ('required' in element && (element as HTMLInputElement).required)) {
    states.push('required');
  }
  if (attr('aria-invalid') === 'true') states.push('invalid');
  if (attr('aria-readonly') === 'true') states.push('read only');

  const current = attr('aria-current');
  if (isOn(current)) states.push(current === 'true' ? 'current' : `current ${current}`);

  const haspopup = attr('aria-haspopup');
  if (isOn(haspopup)) states.push(haspopup === 'true' ? 'has popup' : `has ${haspopup} popup`);

  const level = attr('aria-level') ?? headingLevel(element);
  if (level) states.push(`level ${level}`);

  const posinset = attr('aria-posinset');
  const setsize = attr('aria-setsize');
  if (posinset && setsize) states.push(`${posinset} of ${setsize}`);

  return states;
}

/** The heading level for a native `h1`–`h6`, else null. */
function headingLevel(element: Element): string | null {
  const match = /^h([1-6])$/.exec(element.tagName.toLowerCase());
  return match ? match[1] : null;
}
