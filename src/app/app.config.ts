import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { FsApi, TauriFsApi } from './core/fs/fs-api';
import { SessionApi, TauriSessionApi } from './core/session/session-api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: FsApi, useClass: TauriFsApi },
    { provide: SessionApi, useClass: TauriSessionApi },
  ],
};
