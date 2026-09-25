import { build, type Metafile } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the package's central promise: axe-core (≈550 KB) is *never* pulled into
 * a consumer's initial bundle. These assertions bundle the real entry with
 * esbuild and inspect the module graph, so a regression (e.g. turning the
 * dynamic `import('axe-core')` into a static import, or giving the package a
 * top-level side effect) fails CI instead of silently shipping axe to prod.
 *
 * `@angular/core` / `rxjs` are peers a consumer already ships, so they are
 * external here — we only care where *our* code and axe-core land.
 */
const srcDir = dirname(fileURLToPath(import.meta.url));
const entry = resolve(srcDir, '..', 'index.ts');
const external = ['@angular/core', 'rxjs'];

const AXE = /axe-core/;

/** The input path esbuild treated as the entry point. */
function entryInput(meta: Metafile): string {
  const out = Object.values(meta.outputs).find((o) => o.entryPoint);
  if (!out?.entryPoint) throw new Error('no entry point in metafile');
  return out.entryPoint;
}

/**
 * Inputs reachable from `start` in the module graph. With `dynamic: false`,
 * dynamic-import() edges are not traversed — so the result is exactly what a
 * consumer's *initial* bundle statically pulls in.
 */
function reachable(meta: Metafile, start: string, dynamic: boolean): Set<string> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const node = meta.inputs[stack.pop()!];
    if (!node) continue;
    for (const imp of node.imports) {
      if (!dynamic && imp.kind === 'dynamic-import') continue;
      if (!seen.has(imp.path)) {
        seen.add(imp.path);
        stack.push(imp.path);
      }
    }
  }
  return seen;
}

async function bundleGraph(): Promise<Metafile> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    write: false,
    metafile: true,
    outfile: 'virtual.js',
    external,
    logLevel: 'silent',
  });
  return result.metafile;
}

describe('production weight (axe-core stays out of the initial bundle)', () => {
  it('reaches axe-core only through a dynamic import, never statically', async () => {
    const meta = await bundleGraph();
    const start = entryInput(meta);

    const staticOnly = [...reachable(meta, start, false)];
    const withDynamic = [...reachable(meta, start, true)];

    // Static graph must be axe-free: nothing a consumer eagerly loads pulls it in.
    expect(staticOnly.filter((i) => AXE.test(i))).toEqual([]);
    // But axe is still there — reachable once dynamic imports are followed.
    expect(withDynamic.some((i) => AXE.test(i))).toBe(true);
  });

  it('keeps report-mode (headless driver + playwright) out of the browser entry graph', async () => {
    const meta = await bundleGraph();
    const start = entryInput(meta);

    // Follow dynamic imports too: report-mode must be unreachable from `.` by ANY path.
    const all = [...reachable(meta, start, true)];
    expect(all.some((i) => /report\/headless/.test(i))).toBe(false);
    expect(all.some((i) => /playwright/.test(i))).toBe(false);
    // Sanity: the shared *pure* formatter is allowed in the browser graph
    // (the console logger reuses `groupByComponent`).
    expect(all.some((i) => /report\/format/.test(i))).toBe(true);
  });

  it('drops axe-core entirely when the provider is imported but unused (dead prod branch)', async () => {
    // Mirrors a production build where `isDevMode()` is false, so the
    // `provideA11yDevtools(...)` call is dead-code-eliminated. If the package
    // is free of top-level side effects, nothing — including axe — survives.
    const result = await build({
      stdin: {
        contents: `
          import { provideA11yDevtools } from './index';
          // provideA11yDevtools is intentionally never called here.
          globalThis.keepAlive = 'app';
        `,
        resolveDir: resolve(srcDir, '..'),
        loader: 'ts',
      },
      bundle: true,
      format: 'esm',
      minify: true,
      write: false,
      external,
      logLevel: 'silent',
    });

    const output = result.outputFiles.map((f) => f.text).join('\n');
    expect(output).not.toMatch(AXE);
    expect(output).not.toContain('getOwningComponent'); // attribution gone too
    expect(output).not.toContain('ngb-a11y-overlay'); // overlay gone too
  });

  it('tree-shakes the whole implementation when called in a production build (ngDevMode = false)', async () => {
    // The common setup: `provideA11yDevtools(...)` called unconditionally (or
    // behind a runtime isDevMode() ternary). The Angular CLI defines ngDevMode
    // as false in production, which makes the provider's early return constant.
    const bundleApp = async (define: Record<string, string>): Promise<string> => {
      const result = await build({
        stdin: {
          contents: `
            import { provideA11yDevtools } from './index';
            globalThis.providers = [provideA11yDevtools({ overlay: true, keyboard: true })];
          `,
          resolveDir: resolve(srcDir, '..'),
          loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        splitting: true, // as the Angular CLI does: dynamic imports become their own chunks
        outdir: 'virtual-out',
        entryNames: 'entry',
        minify: true,
        write: false,
        external,
        define,
        logLevel: 'silent',
      });
      // Only the entry chunk is what the app downloads. esbuild still emits a
      // chunk for a dynamic import that sits in dead code, but nothing loads it.
      return result.outputFiles.find((f) => /entry\.js$/.test(f.path))!.text;
    };

    const prod = await bundleApp({ ngDevMode: 'false' });
    expect(prod).not.toMatch(AXE);
    expect(prod).not.toContain('ngb-a11y-overlay'); // overlay
    expect(prod).not.toContain('ngbr-a11y-devtools'); // pill + settings storage
    expect(prod).not.toContain('Download report'); // menu

    expect(prod.length).toBeLessThan(2000); // just the provider shell

    // Control: without the define (a dev build), the same code is all there.
    const dev = await bundleApp({});
    expect(dev).toContain('ngb-a11y-overlay');
    expect(dev).toContain('Download report');
  });
});
