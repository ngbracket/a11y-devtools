export { provideA11yDevtools, type A11yDevtoolsOptions } from './provider.js';
export { runA11yScan, type RunOptions } from './runner.js';
export { scan, type A11yFinding, type Impact, type ScanOptions } from './scan.js';
export { logFindings, type Logger } from './report.js';
export {
  resolveOwningComponentName,
  resolveComponentPath,
  appComponentFromPath,
  resolveListenerEvents,
  DEFAULT_FRAMEWORK_PREFIXES,
  ngDebug,
  type NgDebugGlobal,
  type NgListener,
} from './attribution.js';
export {
  tabSequence,
  isTabbable,
  isNativelyFocusable,
  resolvedTabIndex,
  visualOrderJumps,
  type TabStop,
  type TabSequenceOptions,
} from './keyboard/tab-sequence.js';
export { scanKeyboard, type KeyboardScanOptions } from './keyboard/keyboard-scan.js';
export { findUncontainedModals, type UncontainedModal } from './keyboard/focus-trap.js';
export {
  createFocusWalkProbe,
  detectTabTrap,
  type FocusObservation,
  type FocusWalkProbe,
  type TabWalkVerdict,
} from './keyboard/focus-walk.js';
export {
  describeElement,
  accessibleDescription,
  ariaStates,
  type AxDescription,
} from './keyboard/accname.js';
export {
  createOverlay,
  OVERLAY_ATTR,
  OVERLAY_EXCLUDE_SELECTOR,
  type A11yOverlay,
  type OverlayOptions,
  type AxPanelData,
} from './overlay.js';
