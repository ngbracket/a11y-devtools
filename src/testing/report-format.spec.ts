import { describe, expect, it } from 'vitest';
import {
  distinctRuleCount,
  groupByComponent,
  toJson,
  toMarkdown,
  type ScanReport,
} from '../report/format';
import type { A11yFinding } from '../scan';

function finding(partial: Partial<A11yFinding> = {}): A11yFinding {
  return {
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
    component: 'UserCardComponent',
    directives: [],
    target: 'img',
    html: '<img src="a.png">',
    ...partial,
  };
}

describe('groupByComponent', () => {
  it('buckets findings by owning component and preserves order', () => {
    const groups = groupByComponent([
      finding({ component: 'HeaderComponent', id: 'button-name' }),
      finding({ component: 'UserCardComponent' }),
      finding({ component: 'HeaderComponent', id: 'link-name' }),
    ]);
    expect([...groups.keys()]).toEqual(['HeaderComponent', 'UserCardComponent']);
    expect(groups.get('HeaderComponent')).toHaveLength(2);
  });

  it('labels unattributed findings as (unknown component)', () => {
    const groups = groupByComponent([finding({ component: null })]);
    expect(groups.has('(unknown component)')).toBe(true);
  });
});

describe('distinctRuleCount', () => {
  it('counts unique rule ids, not node-instances', () => {
    const findings = [
      finding({ id: 'region' }),
      finding({ id: 'region' }),
      finding({ id: 'region' }),
      finding({ id: 'button-name' }),
    ];
    expect(findings).toHaveLength(4); // node-instances
    expect(distinctRuleCount(findings)).toBe(2); // distinct rules
  });
});

const report: ScanReport = {
  generatedAt: '2026-09-22T10:00:00.000Z',
  pages: [
    {
      label: 'Dashboard',
      url: 'http://localhost:4200/pages/dashboard',
      findings: [
        finding({ component: 'HeaderComponent', id: 'button-name', impact: 'critical' }),
        finding({ component: 'HeaderComponent', id: 'button-name', impact: 'critical' }),
        finding({ component: 'SettingsComponent', id: 'region', impact: 'moderate' }),
      ],
    },
    { label: 'Login', url: 'http://localhost:4200/login', findings: [] },
  ],
};

describe('toJson', () => {
  it('emits a summary with distinct rules vs node-instances', () => {
    const parsed = JSON.parse(toJson(report));
    expect(parsed.summary).toMatchObject({ pages: 2, distinctRules: 2, nodeInstances: 3 });
    expect(parsed.pages[0]).toMatchObject({ distinctRules: 2, nodeInstances: 3 });
    expect(parsed.pages[1].nodeInstances).toBe(0);
  });
});

describe('toMarkdown', () => {
  const md = toMarkdown(report);

  it('shows distinct-rules alongside node-instances in the summary', () => {
    expect(md).toContain('| Page | Distinct rules | Node-instances | Components |');
    // Total row: 2 distinct rules, 3 node-instances, 2 components.
    expect(md).toContain('| **Total** | **2** | **3** | **2** |');
  });

  it('groups findings under their owning component', () => {
    expect(md).toContain('### ♿ HeaderComponent — 2 issue(s)');
    expect(md).toContain('### ♿ SettingsComponent — 1 issue(s)');
  });

  it('reports a clean page as no violations', () => {
    expect(md).toContain('No violations found. ✅');
  });
});
