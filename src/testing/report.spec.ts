import { describe, expect, it, vi } from 'vitest';
import { logFindings, type Logger } from '../report';
import type { A11yFinding } from '../scan';

const finding = (over: Partial<A11yFinding>): A11yFinding => ({
  id: 'image-alt',
  impact: 'critical',
  help: 'Images must have alternate text',
  helpUrl: 'https://example.test/image-alt',
  component: 'UserCardComponent',
  directives: [],
  target: 'img',
  html: '<img>',
  ...over,
});

function fakeLogger(): Logger & { groupCollapsed: ReturnType<typeof vi.fn> } {
  return {
    groupCollapsed: vi.fn(),
    groupEnd: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  };
}

describe('logFindings', () => {
  it('groups findings by component with a per-group count', () => {
    const logger = fakeLogger();
    logFindings(
      [
        finding({ component: 'UserCardComponent', id: 'image-alt' }),
        finding({ component: 'UserCardComponent', id: 'color-contrast' }),
        finding({ component: 'NavBarComponent', id: 'link-name' }),
      ],
      logger,
    );

    expect(logger.groupCollapsed).toHaveBeenCalledTimes(2);
    expect(logger.groupCollapsed).toHaveBeenCalledWith('♿ UserCardComponent — 2 issue(s)');
    expect(logger.groupCollapsed).toHaveBeenCalledWith('♿ NavBarComponent — 1 issue(s)');
  });

  it('logs a summary line with issue and component counts', () => {
    const logger = fakeLogger();
    logFindings(
      [
        finding({ component: 'UserCardComponent', id: 'image-alt' }),
        finding({ component: 'UserCardComponent', id: 'color-contrast' }),
        finding({ component: 'NavBarComponent', id: 'link-name' }),
      ],
      logger,
    );
    expect(logger.info).toHaveBeenCalledWith('♿ a11y-devtools: 3 issue(s) across 2 component(s)');
  });

  it('annotates a finding with the directives on its node', () => {
    const logger = fakeLogger();
    logFindings([finding({ directives: ['TooltipDirective'] })], logger);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[via TooltipDirective]'),
      expect.anything(),
    );
  });

  it('labels unattributed findings as unknown component', () => {
    const logger = fakeLogger();
    logFindings([finding({ component: null })], logger);
    expect(logger.groupCollapsed).toHaveBeenCalledWith('♿ (unknown component) — 1 issue(s)');
  });

  it('reports a clean result when there are no findings', () => {
    const logger = fakeLogger();
    logFindings([], logger);
    expect(logger.info).toHaveBeenCalledWith('♿ a11y-devtools: no violations found');
    expect(logger.groupCollapsed).not.toHaveBeenCalled();
  });
});
