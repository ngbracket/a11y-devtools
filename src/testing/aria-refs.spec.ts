import { afterEach, describe, expect, it } from 'vitest';
import { MISSING_ID_RULE, scanMissingIdReferences } from '../aria-refs';

function render(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scanMissingIdReferences', () => {
  it('reports a dialog whose aria-labelledby id is missing, as serious under 4.1.2', () => {
    render(`<div role="dialog" aria-modal="true" aria-labelledby="loginDialogTitle"><h2>Guest details</h2></div>`);
    const [finding, ...rest] = scanMissingIdReferences(document);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      id: MISSING_ID_RULE,
      impact: 'serious',
      wcag: ['4.1.2'],
      target: 'div[aria-labelledby]',
      helpUrl: 'https://ngbracket.com/tools/a11y-devtools/docs/missing-id-reference',
    });
    expect(finding.help).toContain('aria-labelledby refers to an id with no element in the page ("loginDialogTitle")');
    expect(finding.help).toContain('so the element gets no name from it. Give the element it should point to that id');
    expect(finding.help).not.toContain('Heuristic');
  });

  it('is moderate when only some of the ids are missing, and lists just those', () => {
    render(`<span id="first">First</span><input aria-labelledby="first second third">`);
    const [finding] = scanMissingIdReferences(document);
    expect(finding.impact).toBe('moderate');
    expect(finding.help).toContain('ids with no element in the page ("second", "third")');
    expect(finding.help).toContain('so part of the name is missing. Give the element it should point to those ids');
  });

  it('reports aria-describedby under 1.3.1, moderate when none exist and minor when some do', () => {
    render(`<span id="hint">Hint</span>
      <input id="a" aria-describedby="gone">
      <input id="b" aria-describedby="hint gone">`);
    const findings = scanMissingIdReferences(document);
    expect(findings.map((f) => [f.target, f.impact, f.wcag])).toEqual([
      ['input#a[aria-describedby]', 'moderate', ['1.3.1']],
      ['input#b[aria-describedby]', 'minor', ['1.3.1']],
    ]);
  });

  it('gives a broken labelledby and describedby on one element a finding each, with different targets', () => {
    render(`<button id="x" aria-labelledby="nope" aria-describedby="nada">Go</button>`);
    expect(scanMissingIdReferences(document).map((f) => f.target)).toEqual([
      'button#x[aria-labelledby]',
      'button#x[aria-describedby]',
    ]);
  });

  it('reports nothing when every id exists, or the attribute is empty', () => {
    render(`<h2 id="t">Title</h2><p id="d">Text</p>
      <div role="dialog" aria-labelledby=" t " aria-describedby="d t"></div>
      <input aria-describedby="">`);
    expect(scanMissingIdReferences(document)).toEqual([]);
  });

  it('skips hidden and inert elements, and the devtools overlay', () => {
    render(`<div hidden><div role="dialog" aria-labelledby="gone"></div></div>
      <div inert><input aria-labelledby="gone"></div>
      <div data-ngb-a11y-overlay><button aria-describedby="gone">x</button></div>`);
    expect(scanMissingIdReferences(document)).toEqual([]);
  });

  it('looks ids up in the element\'s own shadow root', () => {
    const host = render('').appendChild(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<span id="inside">Name</span><button aria-labelledby="inside">x</button>
      <button aria-labelledby="outside">y</button>`;
    document.body.insertAdjacentHTML('beforeend', '<span id="outside">Not reachable from the shadow root</span>');
    const findings = scanMissingIdReferences(shadow);
    expect(findings).toHaveLength(1);
    expect(findings[0].help).toContain('"outside"');
  });

  it('is minor when the element still gets a name another way, and says where from', () => {
    render(`<button id="b" aria-labelledby="gone">Save</button>
      <input id="i" aria-label="Email" aria-labelledby="gone">
      <label for="l">Phone</label><input id="l" aria-labelledby="gone">
      <div id="d" role="dialog" aria-labelledby="gone"><h2>Guest details</h2></div>
      <div id="g" role="group" aria-labelledby="gone" title="Address"></div>`);
    const byTarget = Object.fromEntries(scanMissingIdReferences(document).map((f) => [f.target, f]));
    expect(byTarget['button#b[aria-labelledby]'].impact).toBe('minor');
    expect(byTarget['button#b[aria-labelledby]'].help).toContain('so browsers ignore it and name the element another way ("Save")');
    expect(byTarget['input#i[aria-labelledby]'].impact).toBe('minor');
    expect(byTarget['input#l[aria-labelledby]'].help).toContain('("Phone")');
    expect(byTarget['div#g[aria-labelledby]'].impact).toBe('minor');
    // A dialog doesn't take its name from its content: nothing is left.
    expect(byTarget['div#d[aria-labelledby]'].impact).toBe('serious');
  });

  it('finds references inside open shadow roots, looking ids up in that shadow root', () => {
    const host = render('').appendChild(document.createElement('div'));
    host.attachShadow({ mode: 'open' }).innerHTML = `<span id="inside">Name</span>
      <div role="dialog" aria-labelledby="inside"></div><div role="dialog" aria-labelledby="outside"></div>`;
    document.body.insertAdjacentHTML('beforeend', '<span id="outside">Not reachable from the shadow root</span>');
    const findings = scanMissingIdReferences(document);
    expect(findings).toHaveLength(1);
    expect(findings[0].help).toContain('"outside"');
  });

  it('checks the root itself when it is an element, and skips detached elements', () => {
    const dialog = render(`<div role="dialog" aria-labelledby="gone"></div>`).firstElementChild!;
    expect(scanMissingIdReferences(dialog)).toHaveLength(1);
    const detached = document.createElement('div');
    detached.innerHTML = `<div role="dialog" aria-labelledby="gone"></div>`;
    expect(scanMissingIdReferences(detached)).toEqual([]);
  });

  it('skips elements inside a closed <details>', () => {
    render(`<details><summary>More</summary><div role="dialog" aria-labelledby="gone"></div></details>`);
    expect(scanMissingIdReferences(document)).toEqual([]);
  });

  it('checks only under the root it is given', () => {
    const inside = render(`<input aria-labelledby="gone">`);
    render(`<input aria-labelledby="also-gone">`);
    expect(scanMissingIdReferences(inside)).toHaveLength(1);
  });
});
