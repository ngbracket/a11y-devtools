/**
 * Build the Angular E2E fixture (e2e/angular-app) with @angular/build's
 * `buildApplication` — the same builder `ng build` uses — without needing the
 * Angular CLI. Writes a development build (window.ng available) and a
 * production build (no debug API) to e2e/angular-app/dist/{dev,prod}/browser.
 *
 *   node scripts/build-angular-fixture.mjs
 */
import { buildApplication } from '@angular/build';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../e2e/angular-app');

const logger = {
  debug() {},
  info() {},
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  fatal: (message) => console.error(message),
  createChild() {
    return logger;
  },
};

/** Build one configuration; resolves with the browser output directory. */
export async function buildFixture(config) {
  const prod = config === 'prod';
  const context = {
    workspaceRoot: FIXTURE_ROOT,
    target: { project: 'fixture', target: 'build', configuration: config },
    logger,
    getProjectMetadata: async () => ({ root: '', sourceRoot: 'src', projectType: 'application' }),
    addTeardown() {},
  };
  const options = {
    browser: 'src/main.ts',
    index: 'src/index.html',
    tsConfig: 'tsconfig.json',
    outputPath: `dist/${config}`,
    optimization: prod,
    sourceMap: false,
    namedChunks: !prod,
    extractLicenses: false,
    progress: false,
    aot: true,
    // axe-core is CommonJS; apps using the provider silence the same warning.
    allowedCommonJsDependencies: ['axe-core'],
  };
  for await (const result of buildApplication(options, context)) {
    if (!result.success) throw new Error(`Angular fixture ${config} build failed: ${result.error ?? 'see errors above'}`);
  }
  return resolve(FIXTURE_ROOT, `dist/${config}/browser`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const config of ['dev', 'prod']) console.log(await buildFixture(config));
}
