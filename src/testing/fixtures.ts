import { ChangeDetectionStrategy, Component, Directive } from '@angular/core';

/** A no-op attribute directive, so directive attribution has something to find. */
@Directive({ selector: '[appTooltip]', standalone: true })
export class TooltipDirective {}

/**
 * Child with an accessibility violation: <img> with no alt (axe `image-alt`),
 * carrying a directive so runtime directive attribution can surface it.
 */
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TooltipDirective],
  template: `<img src="avatar.png" appTooltip />`,
})
export class UserCardComponent {}

/** Host app that renders the child. */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UserCardComponent],
  template: `<app-user-card />`,
})
export class AppComponent {}
