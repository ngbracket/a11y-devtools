import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shipped sources compile to native ESM (`"type": "module"`), where Node
 * requires *explicit* file extensions on relative imports. Bundlers (Angular,
 * esbuild, vite) resolve extensionless specifiers fine, so a missing `.js` is
 * invisible to every other (bundler-based) spec here — it only breaks a real
 * Node/ESM consumer. That regression shipped once in 0.1.0 and was caught by an
 * external install test; this guard keeps it out.
 */
const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shipped = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

describe('packaging: relative specifiers are ESM-resolvable', () => {
  it.each(shipped)('%s: every relative import/export ends in .js', (file) => {
    const source = readFileSync(resolve(srcDir, file), 'utf8');
    const extensionless = [...source.matchAll(/from '(\.\.?\/[^']*)'/g)]
      .map((m) => m[1])
      .filter((spec) => !spec.endsWith('.js'));
    expect(extensionless).toEqual([]);
  });
});
