import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { afterEach } from 'vitest';

// `setupFiles` runs per test file; when vitest reuses a worker across files
// (e.g. a 2-core CI runner) the TestBed singleton persists. Reset first so a
// second `initTestEnvironment` doesn't throw "already been called" — a no-op on
// the first run.
const testBed = getTestBed();
testBed.resetTestEnvironment();
testBed.initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

// Reset the testing module after every test so a configured/instantiated module
// can't leak into the next test — or the next file's `configureTestingModule` —
// when a worker is shared. Isolation-independent; a no-op for non-TestBed specs.
afterEach(() => testBed.resetTestingModule());
