import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideA11yDevtools } from '@ngbracket/a11y-devtools';
import { AppComponent, routes } from './app';

// The in-app provider only with ?overlay, so report-mode runs scan a plain app.
const overlay = new URLSearchParams(location.search).has('overlay');

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    ...(overlay ? [provideA11yDevtools({ overlay: true, keyboard: true, pill: false, log: false })] : []),
  ],
}).catch((err) => console.error(err));
