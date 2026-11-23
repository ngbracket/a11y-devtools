import { describe, expect, it } from 'vitest';
import { findingCriteria, referenceUrl } from '../report/wcag';

describe('findingCriteria', () => {
  it('uses an axe finding\'s own criteria, in document order', () => {
    const ids = findingCriteria({ id: 'link-name', wcag: ['4.1.2', '2.4.4'] }).map((c) => c.id);
    expect(ids).toEqual(['2.4.4', '4.1.2']);
  });

  it('gives a best-practice axe rule no criteria', () => {
    expect(findingCriteria({ id: 'region', wcag: [] })).toEqual([]);
  });

  it('knows the criteria of the tool\'s own rules', () => {
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
