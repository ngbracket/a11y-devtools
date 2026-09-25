import { IMPACTS, type DevtoolsSettings, type MinImpact } from './settings.js';

export interface PillMenuOptions {
  /** Current settings; the menu reflects them and reports changes. */
  settings: DevtoolsSettings;
  onChange: (settings: DevtoolsSettings) => void;
  /** Download the report for the pages visited so far. */
  onDownload: () => void;
  /** Open the panel above the button (pill at the bottom) or below it. */
  opensUp: boolean;
  /** Align the panel's left edge (pill on the left) or right edge. */
  alignLeft: boolean;
}

export interface PillMenuStatus {
  /** Findings on the current page. */
  found: number;
  /** How many of those are drawn, after the severity filter. */
  shown: number;
  /** Pages recorded for the report. */
  pages: number;
}

export interface PillMenu {
  /** The `⋯` button that opens the panel. */
  button: HTMLButtonElement;
  /** The panel itself (a sibling of the button). */
  panel: HTMLElement;
  setStatus(status: PillMenuStatus): void;
  destroy(): void;
}

const SEVERITY_LABEL: Record<MinImpact, string> = {
  minor: 'All issues',
  moderate: 'Moderate and above',
  serious: 'Serious and above',
  critical: 'Critical only',
};

const LAYER_LABEL: Record<'highlights' | 'tabOrder' | 'focusPreview', [string, string]> = {
  highlights: ['Highlights', 'Boxes over each issue'],
  tabOrder: ['Tab order', 'Numbered path through the page'],
  focusPreview: ['Focus preview', 'Role, name and state of the focused control'],
};

let nextId = 0;

/**
 * The settings menu behind the pill's `⋯` button: a disclosure (APG pattern), not
 * an ARIA menu, because it holds form controls. Native checkboxes and a select,
 * so keyboard and screen-reader support come from the browser. Escape or a click
 * outside closes it; Escape returns focus to the button.
 */
export function createPillMenu(doc: Document, options: PillMenuOptions): PillMenu {
  const id = `ngbr-a11y-menu-${nextId++}`;
  let settings = { ...options.settings };

  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '⋯';
  button.setAttribute('aria-label', 'a11y devtools settings');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  Object.assign(button.style, {
    minWidth: '28px',
    minHeight: '28px',
    padding: '0 8px',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '999px',
    background: 'rgba(20,22,28,0.94)',
    color: '#f4f4f5',
    font: '700 14px/1 ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });

  const panel = doc.createElement('div');
  panel.id = id;
  panel.hidden = true;
  Object.assign(panel.style, {
    position: 'absolute',
    [options.opensUp ? 'bottom' : 'top']: 'calc(100% + 8px)',
    [options.alignLeft ? 'left' : 'right']: '0',
    width: '260px',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(20,22,28,0.97)',
    color: '#f4f4f5',
    font: '13px/1.45 ui-sans-serif, system-ui, sans-serif',
    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
    pointerEvents: 'auto',
    textAlign: 'left',
  });

  const muted = '#b9c0cc'; // 9.9:1 on the panel background

  const status = doc.createElement('p');
  Object.assign(status.style, { margin: '0 0 8px', color: muted });

  const fieldset = doc.createElement('fieldset');
  Object.assign(fieldset.style, { margin: '0 0 10px', padding: '0', border: '0' });
  const legend = doc.createElement('legend');
  legend.textContent = 'Show on the page';
  Object.assign(legend.style, { padding: '0', marginBottom: '4px', fontWeight: '700' });
  fieldset.append(legend);

  for (const key of Object.keys(LAYER_LABEL) as (keyof typeof LAYER_LABEL)[]) {
    const [text, hint] = LAYER_LABEL[key];
    const label = doc.createElement('label');
    Object.assign(label.style, { display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '3px 0', cursor: 'pointer' });
    const box = doc.createElement('input');
    box.type = 'checkbox';
    // Name is just the setting ("Tab order"); the hint is its description.
    box.setAttribute('aria-labelledby', `${id}-${key}`);
    box.setAttribute('aria-describedby', `${id}-${key}-hint`);
    box.checked = settings[key];
    Object.assign(box.style, { width: '16px', height: '16px', margin: '2px 0 0', accentColor: '#3ecf8e' });
    box.addEventListener('change', () => update({ [key]: box.checked }));
    const words = doc.createElement('span');
    const name = doc.createElement('span');
    name.id = `${id}-${key}`;
    name.textContent = text;
    const sub = doc.createElement('span');
    sub.id = `${id}-${key}-hint`;
    sub.textContent = hint;
    Object.assign(sub.style, { display: 'block', fontSize: '12px', color: muted });
    words.append(name, sub);
    label.append(box, words);
    fieldset.append(label);
  }

  const severityLabel = doc.createElement('label');
  severityLabel.textContent = 'Show issues';
  Object.assign(severityLabel.style, { display: 'block', fontWeight: '700', marginBottom: '4px' });
  const select = doc.createElement('select');
  select.id = `${id}-severity`;
  severityLabel.htmlFor = select.id;
  for (const impact of IMPACTS) {
    const opt = doc.createElement('option');
    opt.value = impact;
    opt.textContent = SEVERITY_LABEL[impact];
    select.append(opt);
  }
  select.value = settings.minImpact;
  Object.assign(select.style, {
    width: '100%',
    minHeight: '28px',
    marginBottom: '10px',
    font: 'inherit',
    color: '#f4f4f5',
    background: '#2a2e37',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '4px',
  });
  select.addEventListener('change', () => update({ minImpact: select.value as MinImpact }));

  const download = doc.createElement('button');
  download.type = 'button';
  download.textContent = 'Download report';
  Object.assign(download.style, {
    width: '100%',
    minHeight: '28px',
    font: '600 13px/1 ui-sans-serif, system-ui, sans-serif',
    color: '#0d1f17',
    background: '#3ecf8e',
    border: '0',
    borderRadius: '4px',
    cursor: 'pointer',
  });
  download.addEventListener('click', () => options.onDownload());
  const pagesNote = doc.createElement('p');
  Object.assign(pagesNote.style, { margin: '4px 0 0', fontSize: '12px', color: muted });

  panel.append(status, fieldset, severityLabel, select, download, pagesNote);

  function update(patch: Partial<DevtoolsSettings>): void {
    settings = { ...settings, ...patch };
    options.onChange(settings);
  }

  let isOpen = false;
  const setOpen = (open: boolean): void => {
    isOpen = open;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => setOpen(!isOpen));

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !isOpen) return;
    event.stopPropagation(); // don't also close an app dialog underneath
    setOpen(false);
    button.focus();
  };
  panel.addEventListener('keydown', onKeyDown);
  button.addEventListener('keydown', onKeyDown);

  const onPointerDown = (event: Event): void => {
    const target = event.target as Node | null;
    if (isOpen && target && !panel.contains(target) && !button.contains(target)) setOpen(false);
  };
  doc.addEventListener('pointerdown', onPointerDown, true);

  // Inline styles can't do :focus-visible; draw the rings from focus events.
  for (const el of [button, download, select]) {
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) {
        el.style.outline = '2px solid #7ab8ff';
        el.style.outlineOffset = '2px';
      }
    });
    el.addEventListener('blur', () => {
      el.style.outline = '';
    });
  }

  return {
    button,
    panel,
    setStatus({ found, shown, pages }) {
      const issues = `${found} ${found === 1 ? 'issue' : 'issues'} on this page`;
      status.textContent = shown === found ? issues : `${issues}, ${shown} shown`;
      pagesNote.textContent = `Covers ${pages} ${pages === 1 ? 'page' : 'pages'} visited since the app loaded.`;
      download.disabled = pages === 0;
      download.style.opacity = pages === 0 ? '0.6' : '1';
    },
    destroy() {
      doc.removeEventListener('pointerdown', onPointerDown, true);
    },
  };
}
