import { afterEach, describe, expect, it } from 'vitest';
import { formatStep, parseReport, toJson, toMarkdown, type ScanReport } from '../report/format';
import { toHtml } from '../report/html';
import { linearWalkthrough, WALKTHROUGH_MAX_STEPS, type WalkthroughStep } from '../keyboard/walkthrough';

function step(partial: Partial<WalkthroughStep> = {}): WalkthroughStep {
  return {
    order: 1,
    role: 'button',
    name: 'Save',
    description: '',
    states: [],
    tag: 'button',
    positive: false,
    component: 'SaveBarComponent',
    ...partial,
  };
}

const report = (walkthrough?: ScanReport['pages'][number]['walkthrough']): ScanReport => ({
  generatedAt: '2026-10-10T00:00:00.000Z',
  pages: [{ label: 'Home', url: 'http://localhost/', findings: [], ...(walkthrough && { walkthrough }) }],
});

describe('formatStep', () => {
  it('reads role, quoted name, states, then component', () => {
    expect(formatStep(step({ states: ['disabled'] }))).toBe('button "Save" (disabled) — SaveBarComponent');
  });

  it('flags a missing name, a missing role and a positive tabindex', () => {
    expect(formatStep(step({ role: null, name: '', tag: 'div', positive: true, component: null }))).toBe(
      '<div> (no accessible name) [positive tabindex]',
    );
  });
});

describe('walkthrough in reports', () => {
  const walk = { steps: [step(), step({ order: 2, role: 'link', name: 'Help <b>*now*</b>', component: null })], total: 2 };

  it('is left out of every format when the run did not ask for it', () => {
    expect(toMarkdown(report())).not.toContain('Tab order walkthrough');
    expect(toHtml(report())).not.toContain('Tab order walkthrough');
    expect(JSON.parse(toJson(report())).pages[0].walkthrough).toBeUndefined();
  });

  it('lists the steps in Markdown, escaping page text', () => {
    const md = toMarkdown(report(walk));
    expect(md).toContain('### Tab order walkthrough');
    expect(md).toContain('not what any one screen reader announces');
    expect(md).toContain('1. button "Save" — SaveBarComponent');
    expect(md).toContain('2. link "Help \\<b\\>\\*now\\*\\</b\\>"');
  });

  it('lists the steps as an ordered list in HTML, escaped', () => {
    const html = toHtml(report(walk));
    expect(html).toContain('<h3>Tab order walkthrough</h3>');
    expect(html).toMatch(/<ol>\s*<li>button &quot;Save&quot; — SaveBarComponent<\/li>\s*<li>link &quot;Help &lt;b&gt;/);
  });

  it('says when the list was capped', () => {
    const capped = { steps: [step()], total: 412 };
    expect(toMarkdown(report(capped))).toContain('Showing the first 1 of 412 tab stops.');
    expect(toHtml(report(capped))).toContain('Showing the first 1 of 412 tab stops.');
  });

  it('says when a page has no tab stops', () => {
    expect(toMarkdown(report({ steps: [], total: 0 }))).toContain('No tab stops on this page.');
  });

  it('survives a JSON round trip, and a malformed one is dropped', () => {
    expect(parseReport(toJson(report(walk))).pages[0].walkthrough).toEqual(walk);
    const bad = JSON.parse(toJson(report(walk)));
    bad.pages[0].walkthrough = { steps: 'nope' };
    expect(parseReport(JSON.stringify(bad)).pages[0].walkthrough).toBeUndefined();
  });
});

describe('linearWalkthrough', () => {
  afterEach(() => document.body.replaceChildren());

  it('describes each tab stop in tab order', async () => {
    document.body.innerHTML = `
      <button aria-pressed="true">Bold</button>
      <a href="#x" tabindex="1">Skip</a>
      <input aria-label="Search">`;
    const { steps, total } = await linearWalkthrough(document, { frameworkPrefixes: [] });
    expect(total).toBe(3);
    expect(steps.map((s) => [s.order, s.role, s.name, s.states, s.positive, s.tag])).toEqual([
      [1, 'link', 'Skip', [], true, 'a'],
      [2, 'button', 'Bold', ['pressed'], false, 'button'],
      [3, 'textbox', 'Search', [], false, 'input'],
    ]);
  });

  it(`stops at ${WALKTHROUGH_MAX_STEPS} steps and keeps the real total`, async () => {
    document.body.innerHTML = Array.from({ length: WALKTHROUGH_MAX_STEPS + 5 }, (_, i) => `<button>B${i}</button>`).join('');
    const { steps, total } = await linearWalkthrough(document);
    expect(steps).toHaveLength(WALKTHROUGH_MAX_STEPS);
    expect(total).toBe(WALKTHROUGH_MAX_STEPS + 5);
  });
});
