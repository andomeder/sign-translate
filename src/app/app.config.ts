import {ApplicationConfig, APP_INITIALIZER} from '@angular/core';
import {provideRouter, RouteReuseStrategy} from '@angular/router';

import {routes} from './app.routes';
import {provideClientHydration, withEventReplay} from '@angular/platform-browser';
import {NavigatorService} from './core/services/navigator/navigator.service';
import {IonicRouteStrategy, provideIonicAngular} from '@ionic/angular/standalone';
import {HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi} from '@angular/common/http';
import {TokenInterceptor} from './core/services/http/token-interceptor.service';
import {AppTranslocoProviders} from './core/modules/transloco/transloco.module';
import {NgxsModuleOptions, provideStore} from '@ngxs/store';
import {SettingsState} from './modules/settings/settings.state';
import {environment} from '../environments/environment';
import {provideServiceWorker} from '@angular/service-worker';
import {isSafari} from './core/constants';
import {provideAnimations} from '@angular/platform-browser/animations';

export const ngxsConfig: NgxsModuleOptions = {
  developmentMode: !environment.production,
  selectorOptions: {
    // These Selector Settings are recommended in preparation for NGXS v4
    // (See above for their effects)
    suppressErrors: false,
    injectContainerState: false,
  },
  compatibility: {
    strictContentSecurityPolicy: true,
  },
};

// Factory function to load Stencil components ONLY in the browser
function initializeStencilComponents() {
  return () => {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Check if running in Tauri
      const isTauri = (window as any).__TAURI__ !== undefined;

      // Extra delay for Tauri
      const delay = isTauri ? 2000 : 500;

      return new Promise<void>(resolve => {
        setTimeout(async () => {
          console.log(`🔧 Initializing Stencil (${isTauri ? 'Tauri' : 'Browser'} mode, ${delay}ms delay)`);
          try {
            const module = await import('pose-viewer/loader');
            await module.defineCustomElements(window);
            console.log('✓ Stencil components loaded');
          } catch (error) {
            console.error('✗ Failed to load Stencil:', error);
          }
          resolve();
        }, delay);
      });
    }
    return Promise.resolve();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),

    // Router
    provideRouter(routes),
    {provide: RouteReuseStrategy, useClass: IonicRouteStrategy},

    // Ionic theme
    provideIonicAngular({mode: isSafari ? 'ios' : 'md'}),
    provideAnimations(),

    // Service Worker
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production,
      // Register the ServiceWorker as soon as the app is stable
      // or after 30 seconds (whichever comes first).
      registrationStrategy: 'registerWhenStable:30000',
    }),

    NavigatorService,

    // HTTP Requests
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    {provide: HTTP_INTERCEPTORS, useClass: TokenInterceptor, multi: true}, // TODO withInterceptors

    ...AppTranslocoProviders,

    provideStore([SettingsState], ngxsConfig),

    // Initialize Stencil components (pose-viewer) in browser only
    {
      provide: APP_INITIALIZER,
      useFactory: initializeStencilComponents,
      multi: true,
    },
  ],
};
