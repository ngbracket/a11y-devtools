import { afterEach, describe, expect, it } from 'vitest';
import { accessibleDescription, ariaStates, describeElement } from '../keyboard/accname';

function fixture(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('accname — computed role/name via axe commons', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('computes role and accessible name from aria-label', async () => {
    const host = fixture(`<button aria-label="Save file">x</button>`);
    const desc = await describeElement(host.querySelector('button')!);
    expect(desc.role).toBe('button');
    expect(desc.name).toBe('Save file');
  });

  it('resolves a name from an associated <label>', async () => {
    const host = fixture(`<label for="email">Email</label><input id="email" />`);
    const desc = await describeElement(host.querySelector('input')!);
    expect(desc.role).toBe('textbox');
    expect(desc.name).toBe('Email');
  });

  it('reports an empty name when there is none (a finding worth noticing)', async () => {
    const host = fixture(`<button></button>`);
    const desc = await describeElement(host.querySelector('button')!);
    expect(desc.role).toBe('button');
    expect(desc.name).toBe('');
  });

  it('surfaces role, name, description and states together', async () => {
    const host = fixture(`
      <div role="checkbox" aria-checked="true" aria-describedby="hint">Accept</div>
      <span id="hint">the terms of service</span>
    `);
    const desc = await describeElement(host.querySelector('[role=checkbox]')!);
    expect(desc.role).toBe('checkbox');
    expect(desc.name).toBe('Accept');
    expect(desc.description).toBe('the terms of service');
    expect(desc.states).toContain('checked');
  });
});

describe('accessibleDescription', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('joins aria-describedby target text', () => {
    const host = fixture(`<button aria-describedby="a b">go</button><span id="a">one</span><span id="b">two</span>`);
    expect(accessibleDescription(host.querySelector('button')!)).toBe('one two');
  });

  it('falls back to the title attribute', () => {
    const host = fixture(`<button title="tooltip text">go</button>`);
    expect(accessibleDescription(host.querySelector('button')!)).toBe('tooltip text');
  });
});

describe('ariaStates', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const statesOf = (html: string) => {
    const host = fixture(html);
    return ariaStates(host.firstElementChild!);
  };

  it('reads expanded / collapsed', () => {
    expect(statesOf(`<button aria-expanded="true">m</button>`)).toContain('expanded');
    expect(statesOf(`<button aria-expanded="false">m</button>`)).toContain('collapsed');
  });

  it('reads a native checkbox checked state', () => {
    const host = fixture(`<input type="checkbox" checked />`);
    expect(ariaStates(host.querySelector('input')!)).toContain('checked');
  });

  it('reads disabled and required from native and ARIA', () => {
    expect(statesOf(`<input required aria-disabled="true" />`)).toEqual(
      expect.arrayContaining(['disabled', 'required']),
    );
  });

  it('reads aria-current and position in set', () => {
    expect(statesOf(`<a href="#" aria-current="page">x</a>`)).toContain('current page');
    expect(statesOf(`<li role="option" aria-posinset="3" aria-setsize="8">x</li>`)).toContain('3 of 8');
  });

  it('reads a native heading level', () => {
    expect(statesOf(`<h2>Title</h2>`)).toContain('level 2');
  });
});
