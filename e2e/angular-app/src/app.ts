/**
 * A tiny Angular app where every accessibility problem has a known owner, so the
 * E2E spec can check that findings are attributed to the right component
 * through the real `window.ng` debug API.
 */
import { Dialog } from '@angular/cdk/dialog';
import { afterNextRender, Component, Directive, inject } from '@angular/core';

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
    <!-- Hover-only content: a hand-built tooltip and an icon title Tab can't reach. -->
    <span class="hover-hint" (mouseenter)="noop()" (mouseleave)="noop()">ⓘ</span>
    <span class="title-icon" title="Mandatory"></span>
    <!-- Drag and drop (CDK's classes, written by hand): handles Tab can't reach, and a
         handle that moves its item with the arrow keys. -->
    <ul class="cdk-drop-list drag-mouse-only">
      <li class="cdk-drag"><span class="cdk-drag-handle">⠿</span>One</li>
      <li class="cdk-drag"><span class="cdk-drag-handle">⠿</span>Two</li>
    </ul>
    <ul class="cdk-drop-list drag-keys">
      <li class="cdk-drag">
        <button class="cdk-drag-handle" aria-label="Move One" (keydown.arrowUp)="noop()">⠿</button>One
      </li>
    </ul>
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

/** The content of the real CDK dialog that DialogPageComponent opens. */
@Component({
  selector: 'app-dialog-content',
  template: `<h2>Edit level</h2><input class="dialog-name" aria-label="Name" /><button class="dialog-save">Save</button>`,
})
export class DialogContentComponent {}

/**
 * Opens a real Angular CDK dialog on load. CDK and Material dialogs default to
 * aria-modal="false" and put their focus-trap anchors beside the container, so
 * this checks the tab-order layer shows only the dialog's stops.
 */
@Component({
  selector: 'app-dialog-page',
  template: `<h1>Dialog</h1><button class="behind-dialog">Behind the dialog</button>`,
})
export class DialogPageComponent {
  private readonly dialog = inject(Dialog);
  constructor() {
    afterNextRender(() => this.dialog.open(DialogContentComponent));
  }
}

@Component({
  selector: 'app-root',
  imports: [HeaderComponent, HomePageComponent, SettingsPageComponent, DialogPageComponent],
  template: `
    <app-header />
    <main>
      @if (page === 'settings') {
        <app-settings-page />
      } @else if (page === 'dialog') {
        <app-dialog-page />
      } @else {
        <app-home-page />
      }
    </main>
  `,
})
export class AppComponent {
  // No router needed: the route picks the page.
  page = location.pathname.startsWith('/settings')
    ? 'settings'
    : location.pathname.startsWith('/dialog')
      ? 'dialog'
      : 'home';
}
