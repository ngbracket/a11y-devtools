import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ngDebug,
  resolveComponentPath,
  resolveDirectiveNames,
  resolveOwningComponentName,
} from '../attribution';
import { AppComponent } from './fixtures';

describe('attribution', () => {
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('publishes the ng debug global once a component is created', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    expect(ngDebug()).toBeDefined();
  });

  it('resolves an inner node to the component that rendered it', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const img = host.querySelector('img')!;
    expect(resolveOwningComponentName(img)).toBe('UserCardComponent');

    host.remove();
  });

  it('surfaces directives applied to the flagged node', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const img = host.querySelector('img')!;
    expect(resolveDirectiveNames(img)).toContain('TooltipDirective');

    host.remove();
  });

  it('walks past a third-party UI primitive to the app component that placed it', () => {
    // <button nbButton> in a HeaderComponent template: the button is owned by
    // NbButtonComponent, but the fixable owner is HeaderComponent.
    const header = document.createElement('div');
    const button = document.createElement('button');
    header.appendChild(button);
    host.appendChild(header);

    const original = (globalThis as { ng?: unknown }).ng;
    (globalThis as { ng?: unknown }).ng = {
      getComponent: (el: Element) =>
        el === button ? { constructor: { name: 'NbButtonComponent' } } : null,
      getOwningComponent: (el: Element) =>
        el === button
          ? { constructor: { name: 'NbButtonComponent' } }
          : { constructor: { name: 'HeaderComponent' } },
      getDirectives: () => [],
    };
    try {
      expect(resolveComponentPath(button)).toEqual(['NbButtonComponent', 'HeaderComponent']);
      expect(resolveOwningComponentName(button)).toBe('HeaderComponent');
    } finally {
      (globalThis as { ng?: unknown }).ng = original;
      host.remove();
    }
  });

  it('strips a leading underscore from emitted class names', () => {
    const original = (globalThis as { ng?: unknown }).ng;
    (globalThis as { ng?: unknown }).ng = {
      getComponent: () => ({ constructor: { name: '_Login' } }),
      getOwningComponent: () => null,
      getDirectives: () => [],
    };
    try {
      expect(resolveOwningComponentName(document.createElement('div'))).toBe('Login');
    } finally {
      (globalThis as { ng?: unknown }).ng = original;
    }
  });
});
