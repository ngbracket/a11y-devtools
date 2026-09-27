import { bootstrapApplication } from '@angular/platform-browser';
import { provideA11yDevtools } from '@ngbracket/a11y-devtools';
import { AppComponent } from './app';

// The in-app provider only with ?overlay, so report-mode runs scan a plain app.
const overlay = new URLSearchParams(location.search).has('overlay');

bootstrapApplication(AppComponent, {
  providers: overlay ? [provideA11yDevtools({ overlay: true, keyboard: true, pill: false, log: false })] : [],
}).catch((err) => console.error(err));
