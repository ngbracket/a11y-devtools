import type { BaselineDiff } from './baseline.js';
import {
  addedBySeverity,
  DARK_ONLY_NOTE,
  bySeverity,
  distinctRuleCount,
  groupByComponent,
  viaNames,
  type ScanReport,
} from './format.js';

/**
 * A single self-contained HTML report: inline CSS, no scripts, no external
 * requests — so it can be attached to a CI run, emailed, or opened offline.
 * Same content as the Markdown report (summary, optional baseline comparison,
 * findings grouped by owning component, most severe first).
 *
 * An accessibility tool's own report has to be accessible: landmarks, a
 * sequential heading outline, a real data table with header cells, severity
 * given as text (never colour alone), and AA contrast in light and dark
 * schemes. Component groups are plain `<h3>` sections rather than
 * `<details>`: a heading inside `<summary>` loses its heading semantics in some
 * browsers, and heading navigation is how screen-reader users move through a
 * long report.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as links; anything else stays plain text. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? escapeHtml(url) : null;
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1a1a1a; --muted: #555555; --line: #d9d9d9; --panel: #f6f6f6;
  --critical: #a4001d; --serious: #9a4400; --moderate: #6b5300; --minor: #1f4e9c;
  --new: #0b6b3a; --link: #0b57d0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161616; --fg: #ececec; --muted: #b5b5b5; --line: #3a3a3a; --panel: #222222;
    --critical: #ff8a9a; --serious: #ffb77a; --moderate: #f0d060; --minor: #9cc3ff;
    --new: #7ee0a8; --link: #9cc3ff;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.25rem; margin: 40px 0 12px; padding-top: 16px; border-top: 1px solid var(--line); }
h3 { font-size: 1.05rem; margin: 0 0 4px; }
.meta { color: var(--muted); margin: 0 0 24px; }
a { color: var(--link); }
code { font: 0.9em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
th[scope="col"]:not(:first-child), td:not(:first-child) { text-align: right; }
tfoot th, tfoot td { font-weight: 700; }
.table-wrap { overflow-x: auto; }
.component { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  margin: 12px 0; padding: 12px 14px 0; }
.count { color: var(--muted); font-weight: 400; }
a:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
ul.findings { list-style: none; margin: 0 0 12px; padding: 0; }
ul.findings > li { padding: 10px 0; border-top: 1px solid var(--line); }
.impact { font-weight: 700; text-transform: uppercase; font-size: 0.8em; letter-spacing: 0.04em; }
.impact-critical { color: var(--critical); } .impact-serious { color: var(--serious); }
.impact-moderate { color: var(--moderate); } .impact-minor { color: var(--minor); }
.new { font-weight: 700; color: var(--new); }
.rule { font-weight: 600; }
.via, .detail { color: var(--muted); font-size: 0.92em; }
.detail { margin: 4px 0 0; }
.ok { color: var(--new); font-weight: 600; }
.error { color: var(--critical); font-weight: 600; }
.diff { background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  margin-top: 32px; padding: 4px 16px; }
.diff h2 { border-top: 0; margin-top: 12px; padding-top: 0; }
`;

/** Render the report as one self-contained, accessible HTML document. */
export function toHtml(report: ScanReport, diff?: BaselineDiff): string {
  const all = report.pages.flatMap((p) => p.findings);
  const added = new Set(diff?.added.map((a) => a.finding));
  const out: string[] = [];

  out.push('<!doctype html>');
  out.push('<html lang="en">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push('<title>Accessibility report</title>');
  out.push(`<style>${STYLES}</style>`);
  out.push('</head>');
  out.push('<body>');
  out.push('<main>');
  out.push('<h1>Accessibility report</h1>');
  out.push(
    `<p class="meta">Generated <time datetime="${escapeHtml(report.generatedAt)}">${escapeHtml(report.generatedAt)}</time> · @ngbracket/a11y-devtools report-mode</p>`,
  );

  // Summary — distinct rules next to raw node-instances, so the bigger number
  // can't be read on its own as "how bad is it".
  out.push('<section aria-labelledby="summary">');
  out.push('<h2 id="summary">Summary</h2>');
  out.push('<div class="table-wrap"><table>');
  out.push(
    '<thead><tr><th scope="col">Page</th><th scope="col">Distinct rules</th><th scope="col">Node-instances</th><th scope="col">Components</th></tr></thead>',
  );
  out.push('<tbody>');
  for (const page of report.pages) {
    out.push(
      `<tr><th scope="row">${escapeHtml(page.label)}</th><td>${distinctRuleCount(page.findings)}</td><td>${page.findings.length}</td><td>${groupByComponent(page.findings).size}</td></tr>`,
    );
  }
  out.push('</tbody>');
  out.push(
    `<tfoot><tr><th scope="row">Total</th><td>${distinctRuleCount(all)}</td><td>${all.length}</td><td>${groupByComponent(all).size}</td></tr></tfoot>`,
  );
  out.push('</table></div>');
  out.push('</section>');

  if (diff) {
    out.push('<section aria-labelledby="baseline" class="diff">');
    out.push('<h2 id="baseline">Compared with baseline</h2>');
    out.push(
      `<p><strong class="new">${diff.added.length} new</strong> · ${diff.fixed.length} fixed · ${diff.unchanged} unchanged</p>`,
    );
    if (diff.added.length) {
      out.push('<ul>');
      for (const { page, finding } of addedBySeverity(diff)) {
        out.push(
          `<li><span class="impact impact-${escapeHtml(finding.impact ?? 'none')}">${escapeHtml(finding.impact ?? 'n/a')}</span> <span class="rule">${escapeHtml(finding.id)}</span> on ${escapeHtml(page)}, in ${escapeHtml(finding.component ?? '(unknown component)')}: <code>${escapeHtml(finding.target)}</code></li>`,
        );
      }
      out.push('</ul>');
    }
    out.push('</section>');
  }

  report.pages.forEach((page, i) => {
    const headingId = `page-${i + 1}`;
    out.push(`<section aria-labelledby="${headingId}">`);
    out.push(
      `<h2 id="${headingId}">${escapeHtml(page.label)} <code>${escapeHtml(page.url)}</code></h2>`,
    );
    if (page.darkOnly) out.push(`<p class="meta">${escapeHtml(DARK_ONLY_NOTE)}</p>`);
    if (page.error) {
      out.push(`<p class="error">Scan failed: ${escapeHtml(page.error)}</p>`);
      out.push('</section>');
      return;
    }
    if (page.findings.length === 0) {
      out.push('<p class="ok">No violations found.</p>');
      out.push('</section>');
      return;
    }
    out.push(
      `<p>${page.findings.length} node-instance(s) across ${distinctRuleCount(page.findings)} distinct rule(s).</p>`,
    );

    const byComponent = [...groupByComponent(page.findings)].sort(
      (a, b) => b[1].length - a[1].length,
    );
    for (const [component, items] of byComponent) {
      out.push('<div class="component">');
      out.push(
        `<h3>${escapeHtml(component)} <span class="count">— ${items.length} issue(s)</span></h3>`,
      );
      out.push('<ul class="findings">');
      for (const finding of bySeverity(items)) {
        const via = viaNames(finding);
        const href = safeHref(finding.helpUrl);
        const impact = finding.impact ?? 'n/a';
        out.push('<li>');
        out.push(
          `${added.has(finding) ? '<span class="new">New</span> · ' : ''}<span class="impact impact-${escapeHtml(finding.impact ?? 'none')}">${escapeHtml(impact)}</span> · <span class="rule">${escapeHtml(finding.id)}</span>: ${escapeHtml(finding.help)}`,
        );
        if (via.length) out.push(` <span class="via">(via ${escapeHtml(via.join(', '))})</span>`);
        out.push(`<p class="detail"><code>${escapeHtml(finding.target)}</code>`);
        if (href) {
          out.push(
            ` · <a href="${href}">Rule reference<span class="visually-hidden"> for ${escapeHtml(finding.id)}</span></a>`,
          );
        }
        out.push('</p>');
        out.push('</li>');
      }
      out.push('</ul>');
      out.push('</div>');
    }
    out.push('</section>');
  });

  out.push('</main>');
  out.push('</body>');
  out.push('</html>');
  return out.join('\n');
}
