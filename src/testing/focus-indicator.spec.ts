import { describe, expect, it } from 'vitest';
import { compareArea, focusChange, minimumArea, visiblePart } from '../keyboard/focus-indicator';

/** RGBA pixels from [r, g, b] triples. */
const px = (...colours: [number, number, number][]) => colours.flatMap(([r, g, b]) => [r, g, b, 255]);

describe('focusChange', () => {
  it('counts no change for identical pixels, or differences within rendering noise', () => {
    expect(focusChange(px([10, 20, 30], [200, 200, 200]), px([10, 20, 30], [201, 202, 200]))).toEqual({
      changed: 0,
      strong: 0,
      maxRatio: 1,
    });
  });

  it('counts a pixel that goes from white to black as a strong change (21:1)', () => {
    const change = focusChange(px([255, 255, 255]), px([0, 0, 0]));
    expect(change).toMatchObject({ changed: 1, strong: 1 });
    expect(change.maxRatio).toBeCloseTo(21, 5);
  });

  it('counts a faint tint as changed but not strong', () => {
    // The lilac pair from the e2e fixture: a background tint of about 1.26:1.
    const change = focusChange(px([0xc8, 0xb6, 0xe2], [0xc8, 0xb6, 0xe2]), px([0xb3, 0x9d, 0xdb], [0xb3, 0x9d, 0xdb]));
    expect(change.changed).toBe(2);
    expect(change.strong).toBe(0);
    expect(change.maxRatio).toBeGreaterThan(1.2);
    expect(change.maxRatio).toBeLessThan(1.35);
  });

  it('counts exactly 3:1 as strong', () => {
    // #767676 on white is 4.54:1; mid-grey #949494 on white is about 3.03:1.
    expect(focusChange(px([255, 255, 255]), px([0x94, 0x94, 0x94])).strong).toBe(1);
  });
});

describe('minimumArea', () => {
  it('is three quarters of a 1px line along the longer side, so a 1px underline passes', () => {
    expect(minimumArea({ x: 0, y: 0, width: 100, height: 20 })).toBe(75);
    expect(minimumArea({ x: 0, y: 0, width: 40, height: 40 })).toBe(30);
  });
});

describe('visiblePart', () => {
  const viewport = { width: 1280, height: 900 };

  it('clips a tall element to the viewport, so the threshold only counts what is on screen', () => {
    const visible = visiblePart({ x: 100, y: -500, width: 600, height: 3000 }, viewport)!;
    expect(visible).toEqual({ x: 100, y: 0, width: 600, height: 900 });
    expect(minimumArea(visible)).toBe(675);
  });

  it('is null for an element fully off screen', () => {
    expect(visiblePart({ x: 0, y: 950, width: 100, height: 40 }, viewport)).toBeNull();
  });
});

describe('compareArea', () => {
  const viewport = { width: 1280, height: 900 };

  it('adds an 8px margin for outlines with an offset', () => {
    expect(compareArea({ x: 100, y: 50, width: 80, height: 30 }, viewport)).toEqual({ x: 92, y: 42, width: 96, height: 46 });
  });

  it('clips to the viewport, and is null for an element fully off screen', () => {
    expect(compareArea({ x: -20, y: 880, width: 60, height: 40 }, viewport)).toEqual({ x: 0, y: 872, width: 48, height: 28 });
    expect(compareArea({ x: 10, y: 1000, width: 60, height: 40 }, viewport)).toBeNull();
  });
});
