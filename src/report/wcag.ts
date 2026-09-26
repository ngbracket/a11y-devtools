/** A WCAG success criterion. */
export interface WcagCriterion {
  /** e.g. `1.4.3`. */
  id: string;
  /** e.g. `Contrast (Minimum)`. */
  name: string;
  level: 'A' | 'AA';
  /** Slug of its W3C "Understanding" page. */
  slug: string;
}

/**
 * WCAG 2.2 Level A and AA success criteria, in document order — the set a
 * VPAT/ACR "WCAG 2.2 Report" table covers. 4.1.1 Parsing is left out: WCAG 2.2
 * marks it obsolete and removed.
 */
export const WCAG22_A_AA: readonly WcagCriterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A', slug: 'non-text-content' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', slug: 'audio-only-and-video-only-prerecorded' },
  { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', slug: 'captions-prerecorded' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', slug: 'audio-description-or-media-alternative-prerecorded' },
  { id: '1.2.4', name: 'Captions (Live)', level: 'AA', slug: 'captions-live' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', slug: 'audio-description-prerecorded' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A', slug: 'info-and-relationships' },
  { id: '1.3.2', name: 'Meaningful Sequence', level: 'A', slug: 'meaningful-sequence' },
  { id: '1.3.3', name: 'Sensory Characteristics', level: 'A', slug: 'sensory-characteristics' },
  { id: '1.3.4', name: 'Orientation', level: 'AA', slug: 'orientation' },
  { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA', slug: 'identify-input-purpose' },
  { id: '1.4.1', name: 'Use of Color', level: 'A', slug: 'use-of-color' },
  { id: '1.4.2', name: 'Audio Control', level: 'A', slug: 'audio-control' },
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', slug: 'contrast-minimum' },
  { id: '1.4.4', name: 'Resize Text', level: 'AA', slug: 'resize-text' },
  { id: '1.4.5', name: 'Images of Text', level: 'AA', slug: 'images-of-text' },
  { id: '1.4.10', name: 'Reflow', level: 'AA', slug: 'reflow' },
  { id: '1.4.11', name: 'Non-text Contrast', level: 'AA', slug: 'non-text-contrast' },
  { id: '1.4.12', name: 'Text Spacing', level: 'AA', slug: 'text-spacing' },
  { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', slug: 'content-on-hover-or-focus' },
  { id: '2.1.1', name: 'Keyboard', level: 'A', slug: 'keyboard' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', slug: 'no-keyboard-trap' },
  { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A', slug: 'character-key-shortcuts' },
  { id: '2.2.1', name: 'Timing Adjustable', level: 'A', slug: 'timing-adjustable' },
  { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', slug: 'pause-stop-hide' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', slug: 'three-flashes-or-below-threshold' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A', slug: 'bypass-blocks' },
  { id: '2.4.2', name: 'Page Titled', level: 'A', slug: 'page-titled' },
  { id: '2.4.3', name: 'Focus Order', level: 'A', slug: 'focus-order' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', slug: 'link-purpose-in-context' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA', slug: 'multiple-ways' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA', slug: 'headings-and-labels' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA', slug: 'focus-visible' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', slug: 'focus-not-obscured-minimum' },
  { id: '2.5.1', name: 'Pointer Gestures', level: 'A', slug: 'pointer-gestures' },
  { id: '2.5.2', name: 'Pointer Cancellation', level: 'A', slug: 'pointer-cancellation' },
  { id: '2.5.3', name: 'Label in Name', level: 'A', slug: 'label-in-name' },
  { id: '2.5.4', name: 'Motion Actuation', level: 'A', slug: 'motion-actuation' },
  { id: '2.5.7', name: 'Dragging Movements', level: 'AA', slug: 'dragging-movements' },
  { id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', slug: 'target-size-minimum' },
  { id: '3.1.1', name: 'Language of Page', level: 'A', slug: 'language-of-page' },
  { id: '3.1.2', name: 'Language of Parts', level: 'AA', slug: 'language-of-parts' },
  { id: '3.2.1', name: 'On Focus', level: 'A', slug: 'on-focus' },
  { id: '3.2.2', name: 'On Input', level: 'A', slug: 'on-input' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', slug: 'consistent-navigation' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA', slug: 'consistent-identification' },
  { id: '3.2.6', name: 'Consistent Help', level: 'A', slug: 'consistent-help' },
  { id: '3.3.1', name: 'Error Identification', level: 'A', slug: 'error-identification' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A', slug: 'labels-or-instructions' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA', slug: 'error-suggestion' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', slug: 'error-prevention-legal-financial-data' },
  { id: '3.3.7', name: 'Redundant Entry', level: 'A', slug: 'redundant-entry' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', slug: 'accessible-authentication-minimum' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A', slug: 'name-role-value' },
  { id: '4.1.3', name: 'Status Messages', level: 'AA', slug: 'status-messages' },
];

/** The W3C "Understanding" page for a criterion. */
export function understandingUrl(criterion: WcagCriterion): string {
  return `https://www.w3.org/WAI/WCAG22/Understanding/${criterion.slug}.html`;
}

/**
 * The criterion an axe tag names, e.g. `wcag143` → `1.4.3`, `wcag1410` →
 * `1.4.10`; undefined for level tags (`wcag2aa`) and criteria outside
 * {@link WCAG22_A_AA}. Dropping the dots is unambiguous within the A/AA set.
 */
export function criterionForTag(tag: string): WcagCriterion | undefined {
  const digits = /^wcag(\d{3,4})$/.exec(tag)?.[1];
  return digits ? BY_DIGITS.get(digits) : undefined;
}

const BY_DIGITS = new Map(WCAG22_A_AA.map((c) => [c.id.replace(/\./g, ''), c]));
