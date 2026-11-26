import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scan } from '../scan';
import { runA11yScan } from '../runner';
import type { Logger } from '../report';
import { AppComponent } from './fixtures';

describe('scan + runner (real axe + attribution)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('enriches an axe violation with its owning component name', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const findings = await scan(host);

    const imgAlt = findings.find((f) => f.id === 'image-alt');
    expect(imgAlt).toBeDefined();
    expect(imgAlt!.component).toBe('UserCardComponent');
    expect(imgAlt!.directives).toContain('TooltipDirective');
    // From axe's wcag111 tag; the reports link it to the reference.
    expect(imgAlt!.wcag).toEqual(['1.1.1']);
  });

  it('adds ngbr/missing-id-reference to every scan, without the keyboard layer', async () => {
    host.innerHTML = `<div role="dialog" aria-labelledby="loginDialogTitle"><h2>Guest details</h2></div>`;
    const findings = await scan(host);
    expect(findings.filter((f) => f.id === 'ngbr/missing-id-reference')).toHaveLength(1);
    host.insertAdjacentHTML('beforeend', '<label for="sn">Surname</label><input id="sn">');
    expect((await scan(host)).map((f) => f.id)).toContain('ngbr/missing-autocomplete');
    const noPurpose = await scan(host, undefined, { inputPurpose: false });
    expect(noPurpose.map((f) => f.id)).not.toContain('ngbr/missing-autocomplete');
    const off = await scan(host, undefined, { idReferences: false });
    expect(off.map((f) => f.id)).not.toContain('ngbr/missing-id-reference');
  });

  it('runA11yScan passes idReferences and inputPurpose through, for the overlay', async () => {
    host.innerHTML = `<div role="dialog" aria-labelledby="gone"></div><label for="sn">Surname</label><input id="sn">`;
    const ids = (f: { id: string }[]) => f.map((x) => x.id);
    const on = ids(await runA11yScan(host, { log: false }));
    expect(on).toEqual(expect.arrayContaining(['ngbr/missing-id-reference', 'ngbr/missing-autocomplete']));
    const off = ids(await runA11yScan(host, { log: false, idReferences: false, inputPurpose: false }));
    expect(off).not.toContain('ngbr/missing-id-reference');
    expect(off).not.toContain('ngbr/missing-autocomplete');
  });

  it('serializes concurrent scans (axe is a singleton)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    // Would throw "Axe is already running" without serialization.
    const [a, b] = await Promise.all([scan(host), scan(host)]);

    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it('runA11yScan reports findings grouped by component', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const logger: Logger = {
      groupCollapsed: vi.fn(),
      groupEnd: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };

    const findings = await runA11yScan(host, { logger });

    expect(findings.length).toBeGreaterThan(0);
    expect(logger.groupCollapsed).toHaveBeenCalledWith(
      expect.stringContaining('UserCardComponent'),
    );
  });

  it('scopes the ruleset when axe run options are passed through', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    host.appendChild(fixture.nativeElement);
    await fixture.whenStable();

    const ids = (findings: { id: string }[]) => new Set(findings.map((f) => f.id));

    const all = ids(await runA11yScan(host, { log: false }));
    const levelA = ids(
      await runA11yScan(host, { log: false, axe: { runOnly: { type: 'tag', values: ['wcag2a'] } } }),
    );

    // image-alt is WCAG 2.0 Level A — kept under a Level-A-only scope.
    expect(levelA.has('image-alt')).toBe(true);
    // color-contrast is Level AA — if the full run flagged it, the A-only run must not.
    if (all.has('color-contrast')) {
      expect(levelA.has('color-contrast')).toBe(false);
    }
    // A scoped run only ever yields a subset of the default run.
    expect([...levelA].every((id) => all.has(id))).toBe(true);
  });
});
