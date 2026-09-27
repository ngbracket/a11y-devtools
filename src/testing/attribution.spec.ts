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

  it('lists each component once, even when projection brings it back up the tree', () => {
    // <app-panel><img></app-panel> in a HomePage template: the DOM path runs
    // img (HomePage) → section (Panel) → <app-panel> host (HomePage) → root.
    const panelHost = document.createElement('app-panel');
    const section = document.createElement('section');
    const img = document.createElement('img');
    section.appendChild(img);
    panelHost.appendChild(section);
    host.appendChild(panelHost);

    const owner = new Map<Element, string>([
      [img, 'HomePageComponent'],
      [section, 'PanelComponent'],
      [panelHost, 'HomePageComponent'],
    ]);
    const original = (globalThis as { ng?: unknown }).ng;
    (globalThis as { ng?: unknown }).ng = {
      getComponent: () => null,
      getOwningComponent: (el: Element) => ({ constructor: { name: owner.get(el) ?? 'AppComponent' } }),
      getDirectives: () => [],
    };
    try {
      expect(resolveComponentPath(img)).toEqual(['HomePageComponent', 'PanelComponent', 'AppComponent']);
      expect(resolveOwningComponentName(img)).toBe('HomePageComponent');
    } finally {
      (globalThis as { ng?: unknown }).ng = original;
      host.remove();
    }
  });

  it('treats a partial ng global (no debug helpers) as no attribution', () => {
    // A production build can leave `window.ng` present but without getComponent/
    // getOwningComponent — must not throw mid-scan.
    const original = (globalThis as { ng?: unknown }).ng;
    (globalThis as { ng?: unknown }).ng = { version: '21.0.0' };
    try {
      expect(resolveComponentPath(document.createElement('div'))).toEqual([]);
      expect(resolveOwningComponentName(document.createElement('div'))).toBeNull();
    } finally {
      (globalThis as { ng?: unknown }).ng = original;
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
