import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ngDebug, resolveOwningComponentName } from '../attribution';
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
});
