import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { FsApi, TauriFsApi } from './core/fs/fs-api';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), { provide: FsApi, useClass: TauriFsApi }],
};
