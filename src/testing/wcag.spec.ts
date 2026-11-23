import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findingCriteria, NGBR_RULE_CRITERIA, referenceUrl } from '../report/wcag';

describe('findingCriteria', () => {
  it('uses an axe finding\'s own criteria, in document order', () => {
    const ids = findingCriteria({ id: 'link-name', wcag: ['4.1.2', '2.4.4'] }).map((c) => c.id);
    expect(ids).toEqual(['2.4.4', '4.1.2']);
  });

  it('gives a best-practice axe rule no criteria', () => {
    expect(findingCriteria({ id: 'region', wcag: [] })).toEqual([]);
  });

  it('falls back to the rule\'s criteria for an ngbr/* finding saved before 0.19.0', () => {
    expect(findingCriteria({ id: 'ngbr/drag-without-keyboard' }).map((c) => c.id)).toEqual(['2.1.1', '2.5.7']);
    expect(findingCriteria({ id: 'ngbr/focus-trap' }).map((c) => c.id)).toEqual(['2.1.2']);
    expect(findingCriteria({ id: 'some-unknown-rule' })).toEqual([]);
  });
});

describe('referenceUrl', () => {
  it('points at the criterion\'s page in the NgBracket reference', () => {
    const [contrast] = findingCriteria({ id: 'color-contrast', wcag: ['1.4.3'] });
    expect(referenceUrl(contrast)).toBe('https://ngbracket.com/reference/wcag/contrast-minimum');
  });
});

describe('NGBR_RULE_CRITERIA', () => {
  it('has criteria for every ngbr/* rule the source emits', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.startsWith('testing'),
    );
    const ids = new Set(files.flatMap((f) => readFileSync(join(src, f), 'utf8').match(/'ngbr\/[a-z-]+'/g) ?? []));
    expect(ids.size).toBeGreaterThanOrEqual(7);
    for (const id of ids) expect(NGBR_RULE_CRITERIA[id.slice(1, -1)], id).toBeDefined();
  });
});
