import { describe, expect, it } from 'vitest';
import { appComponentFromPath, DEFAULT_FRAMEWORK_PREFIXES } from '../attribution';

describe('appComponentFromPath + framework prefixes', () => {
  it('walks past default primitives (Nb*/Mat*/Cdk*/Mdc*) to the app component', () => {
    expect(appComponentFromPath(['NbButtonComponent', 'HeaderComponent'])).toBe('HeaderComponent');
    expect(appComponentFromPath(['MatButton', 'CheckoutComponent'])).toBe('CheckoutComponent');
  });

  it('does not mistake a same-prefix app component for a primitive (CamelCase boundary)', () => {
    // "MatchList" starts with "Mat" but the next char is lowercase → not Material.
    expect(appComponentFromPath(['MatchListComponent'])).toBe('MatchListComponent');
  });

  it('does not skip a component library you author (e.g. Ngbr*)', () => {
    expect(appComponentFromPath(['NgbrCardComponent', 'AppComponent'])).toBe('NgbrCardComponent');
  });

  it('falls back to the immediate owner when the whole chain is primitives', () => {
    expect(appComponentFromPath(['NbButtonComponent', 'NbLayoutComponent'])).toBe(
      'NbButtonComponent',
    );
  });

  it('honours custom prefixes (add another library)', () => {
    const path = ['ClrDropdown', 'ProductComponent'];
    // Default list doesn't know Clarity → the Clr* component is the owner.
    expect(appComponentFromPath(path)).toBe('ClrDropdown');
    // Add "Clr" and it walks past to the app component.
    expect(appComponentFromPath(path, [...DEFAULT_FRAMEWORK_PREFIXES, 'Clr'])).toBe(
      'ProductComponent',
    );
  });

  it('with an empty prefix list, attributes to the immediate owner (skip nothing)', () => {
    // Scanning a library's own code: blame the library component, not a wrapper.
    expect(appComponentFromPath(['NbButtonComponent', 'HeaderComponent'], [])).toBe(
      'NbButtonComponent',
    );
  });

  it('returns null for an empty path', () => {
    expect(appComponentFromPath([])).toBeNull();
  });
});
