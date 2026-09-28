/**
 * A tiny Angular app where every accessibility problem has a known owner, so the
 * E2E spec can check that findings are attributed to the right component
 * through the real `window.ng` debug API.
 */
import { Component, Directive } from '@angular/core';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** image-alt → HeaderComponent. */
@Component({
  selector: 'app-header',
  template: `<header><img class="logo" [src]="pixel" width="10" height="10" /></header>`,
})
export class HeaderComponent {
  pixel = PIXEL;
}

/** A UI-library-style primitive (Nb prefix): findings inside it belong to whoever uses it. */
@Component({
  selector: 'nb-fake-button',
  template: `<button class="nb-icon-button"></button>`,
})
export class NbFakeButtonComponent {}

/** Projects its content; projected nodes still belong to the template that declared them. */
@Component({
  selector: 'app-panel',
  template: `<section class="panel"><h2>Panel</h2><ng-content /></section>`,
})
export class PanelComponent {}

@Directive({ selector: '[appFancy]' })
export class FancyDirective {}

@Component({
  selector: 'app-home-page',
  imports: [NbFakeButtonComponent, PanelComponent, FancyDirective],
  template: `
    <h1>Home</h1>
    <nb-fake-button />
    <app-panel><img class="projected" [src]="pixel" width="10" height="10" /></app-panel>
    <input class="fancy" appFancy />
    <div class="fake-button" role="button" (click)="noop()">Unreachable</div>
    <span class="focusable-no-key" tabindex="0" (click)="noop()">No key handler</span>
    <!-- Key handling through event modifiers: (keydown.enter) is still keydown. -->
    <span class="key-modifiers" tabindex="0" (click)="noop()" (keydown.enter)="noop()" (keydown.space)="noop()">Keys</span>
    <div role="tablist" aria-label="Roving" (keydown.arrowRight)="noop()" (keydown.arrowLeft)="noop()">
      <div role="tab" tabindex="0">One</div>
      <div class="roving-tab" role="tab" tabindex="-1">Two</div>
    </div>
    <!-- Half-built: out of the tab order, but nothing handles the arrow keys. -->
    <div role="tablist" aria-label="Half built">
      <div role="tab" tabindex="0">One</div>
      <div class="half-built-tab" role="tab" tabindex="-1">Two</div>
    </div>
  `,
})
export class HomePageComponent {
  pixel = PIXEL;
  noop(): void {}
}

/** color-contrast → SettingsPageComponent (a second route). */
@Component({
  selector: 'app-settings-page',
  template: `<h1>Settings</h1><p class="faint" style="color: #b0b0b0; background: #ffffff">Low contrast</p>`,
})
export class SettingsPageComponent {}

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, HomePageComponent, SettingsPageComponent],
  template: `
    <app-header />
    <main>
      @if (page === 'settings') {
        <app-settings-page />
      } @else {
        <app-home-page />
      }
    </main>
  `,
})
export class AppComponent {
  // No router needed: the route picks the page.
  page = location.pathname.startsWith('/settings') ? 'settings' : 'home';
}
