import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Child with an accessibility violation: <img> with no alt (axe `image-alt`). */
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img src="avatar.png" />`,
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
