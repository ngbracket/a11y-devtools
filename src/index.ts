export { provideA11yDevtools, type A11yDevtoolsOptions } from './provider.js';
export { runA11yScan, type RunOptions } from './runner.js';
export { scan, type A11yFinding, type Impact } from './scan.js';
export { logFindings, type Logger } from './report.js';
export {
  resolveOwningComponentName,
  resolveComponentPath,
  appComponentFromPath,
  ngDebug,
  type NgDebugGlobal,
} from './attribution.js';
export {
  createOverlay,
  OVERLAY_ATTR,
  OVERLAY_EXCLUDE_SELECTOR,
  type A11yOverlay,
  type OverlayOptions,
} from './overlay.js';
