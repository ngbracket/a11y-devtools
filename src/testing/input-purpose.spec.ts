import { afterEach, describe, expect, it } from 'vitest';
import { inputPurpose, MISSING_AUTOCOMPLETE_RULE, scanMissingAutocomplete } from '../input-purpose';

function render(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

const purposeOf = (html: string) => inputPurpose(render(html).querySelector('input, select, textarea')!)?.purpose;

describe('inputPurpose', () => {
  it.each([
    ['<label for="f">Forename</label><input id="f">', 'given-name'],
    ['<label for="f">First name</label><input id="f">', 'given-name'],
    ['<label for="f">Surname</label><input id="f">', 'family-name'],
    ['<label for="f">Full name</label><input id="f">', 'name'],
    ['<label for="f">Email address</label><input id="f">', 'email'],
    ['<input type="email" aria-label="Contact">', 'email'],
    ['<label for="f">Mobile</label><input id="f">', 'tel'],
    ['<input type="tel">', 'tel'],
    ['<label for="f">Postcode</label><input id="f">', 'postal-code'],
    ['<label for="f">ZIP code</label><input id="f">', 'postal-code'],
    ['<label for="f">Address line 1</label><input id="f">', 'address-line1'],
    ['<input name="addressLine2">', 'address-line2'],
    ['<label for="f">Town/City</label><input id="f">', 'address-level2'],
    ['<label for="f">County</label><input id="f">', 'address-level1'],
    ['<label for="f">Country</label><select id="f"><option>UK</option></select>', 'country-name'],
    ['<label for="f">Date of birth</label><input id="f" type="date">', 'bday'],
    ['<input formcontrolname="firstName">', 'given-name'],
    ['<input name="post_code">', 'postal-code'],
    ['<input placeholder="Your email">', 'email'],
    ['<input type="password">', 'current-password'],
    ['<input placeholder="Last name, First name">', 'name'],
    ['<span id="l">Surname</span><input aria-labelledby="l">', 'family-name'],
  ])('%s → %s', (html, purpose) => {
    expect(purposeOf(html)).toBe(purpose);
  });

  it.each([
    '<label for="f">Name of the class</label><input id="f">',
    '<label for="f">Address</label><input id="f">',
    '<label for="f">Title</label><input id="f">',
    '<label for="f">Promo code</label><input id="f" name="postcode">',
    '<label for="f">Notes</label><textarea id="f"></textarea>',
    '<input name="hotel">',
    '<input name="cityBreakId" aria-label="Holiday">',
    '<label for="f">State</label><input id="f">',
    '<label for="f">Quantity</label><input id="f" type="number">',
    '<label for="f">Address Search (enter postcode or the first line of your address)</label><input id="f">',
    '<label for="f">Find your address</label><input id="f" name="postcode">',
    '<input name="postcodeLookup">',
  ])('no purpose: %s', (html) => {
    expect(purposeOf(html)).toBeUndefined();
  });
});

describe('scanMissingAutocomplete', () => {
  it('reports the guest-details fields of a booking form that have no autocomplete', () => {
    render(`<form>
      <label for="fn">Forename</label><input id="fn">
      <label for="sn">Surname</label><input id="sn">
      <label for="em">Email</label><input id="em" type="email">
      <label for="pc">Postcode</label><input id="pc" autocomplete="postal-code">
      <label for="mb">Mobile</label><input id="mb" autocomplete="off">
    </form>`);
    const findings = scanMissingAutocomplete(document);
    expect(findings.map((f) => f.target)).toEqual(['input#fn', 'input#sn', 'input#em']);
    expect(findings[0]).toMatchObject({
      id: MISSING_AUTOCOMPLETE_RULE,
      impact: 'moderate',
      wcag: ['1.3.5'],
      helpUrl: 'https://ngbracket.com/tools/a11y-devtools/docs/missing-autocomplete',
    });
    expect(findings[0].help).toContain(`the user's own first name (from the label "Forename")`);
    expect(findings[0].help).toContain('Add autocomplete="given-name"');
    expect(findings[0].help).toContain('Heuristic');
    expect(findings[2].help).toContain('(from type="email")');
  });

  it('suggests new-password too for a password field', () => {
    render('<input type="password">');
    expect(scanMissingAutocomplete(document)[0].help).toContain(
      'autocomplete="current-password" (or "new-password" on a sign-up form)',
    );
  });

  it('skips disabled, read-only, hidden, search and button-like fields', () => {
    render(`<label for="a">Email</label><input id="a" disabled>
      <label for="b">Email</label><input id="b" readonly>
      <div hidden><label for="c">Email</label><input id="c"></div>
      <form role="search"><label for="d">Postcode</label><input id="d"></form>
      <input type="search" aria-label="Postcode">
      <input type="hidden" name="email">
      <input type="checkbox" aria-label="Email me offers">
      <input type="submit" value="Email">`);
    expect(scanMissingAutocomplete(document)).toEqual([]);
  });

  it('checks the root itself when it is a field', () => {
    const field = render('<input name="surname">').firstElementChild!;
    expect(scanMissingAutocomplete(field)).toHaveLength(1);
  });
});
