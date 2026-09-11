import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, it } from 'vitest';
import { runA11yScan } from '../runner';
import { AppComponent } from './fixtures';

/**
 * Not an assertion test — a living demo. Renders the fixture and runs the real
 * pipeline (axe scan → `ng` attribution → console reporter) against the REAL
 * `console` so the grouped output is visible in the terminal: the summary line,
 * per-component groups, and the `[via <directive>]` annotation.
 *
 * Run just this file: `npx vitest run src/testing/console-demo.spec.ts`.
 */
describe('console reporter (live demo output)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('prints grouped, attributed findings to the console', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    await runA11yScan(host); // default logger === console

    host.remove();
  });
});
