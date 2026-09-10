import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// `setupFiles` runs per test file; when vitest reuses a worker across files
// (e.g. a 2-core CI runner) the TestBed singleton persists, so a second
// `initTestEnvironment` throws "already been called". Reset first to make setup
// idempotent — a no-op on the first run.
const testBed = getTestBed();
testBed.resetTestEnvironment();
testBed.initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);
