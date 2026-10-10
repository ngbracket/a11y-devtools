/**
 * The linear walkthrough: the page's tab order as a reading list, each stop with
 * its computed role, name and states and the component that rendered it. It's
 * the report-mode form of the overlay's tab-order path and Focus preview.
 *
 * Like the Focus preview, this is a *computed approximation* (see `accname.ts`),
 * never what any one screen reader says.
 */
import { describeElements } from './accname.js';
import { tabSequence, type TabSequenceOptions } from './tab-sequence.js';

/** One tab stop in the walkthrough. Plain data, so it survives JSON. */
export interface WalkthroughStep {
  /** 1-based position in the tab order. */
  order: number;
  /** Computed ARIA role, or null when none resolves. */
  role: string | null;
  /** Computed accessible name; '' when it has none. */
  name: string;
  /** Computed accessible description, or ''. */
  description: string;
  /** State labels, e.g. `['expanded', 'required']`. */
  states: string[];
  /** Tag name of the element, e.g. `button`. */
  tag: string;
  /** True when a positive `tabindex` puts this stop out of DOM order. */
  positive: boolean;
  /** Owning app component, or null. */
  component: string | null;
}

/** Steps past this many are dropped; the report says how many there were. */
export const WALKTHROUGH_MAX_STEPS = 300;

export interface Walkthrough {
  steps: WalkthroughStep[];
  /** Tab stops on the page. More than `steps.length` when the list was capped. */
  total: number;
}

/** Walk the tab order of `root` and describe each stop. */
export async function linearWalkthrough(
  root: ParentNode = document,
  options: Pick<TabSequenceOptions, 'frameworkPrefixes'> = {},
): Promise<Walkthrough> {
  const stops = tabSequence(root, options);
  const kept = stops.slice(0, WALKTHROUGH_MAX_STEPS);
  const described = await describeElements(kept.map((s) => s.element));
  const steps = kept.map((stop, i) => ({
    order: stop.order,
    role: described[i].role,
    name: described[i].name.replace(/\s+/g, ' ').trim(),
    description: described[i].description,
    states: described[i].states,
    tag: stop.element.tagName.toLowerCase(),
    positive: stop.positive,
    component: stop.component,
  }));
  return { steps, total: stops.length };
}
