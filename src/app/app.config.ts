import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { FsApi, TauriFsApi } from './core/fs/fs-api';
import { SessionApi, TauriSessionApi } from './core/session/session-api';
import { KeymapApi, TauriKeymapApi } from './core/actions/keymap-api';
import { JobsApi, TauriJobsApi } from './core/jobs/jobs-api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: FsApi, useClass: TauriFsApi },
    { provide: SessionApi, useClass: TauriSessionApi },
    { provide: KeymapApi, useClass: TauriKeymapApi },
    { provide: JobsApi, useClass: TauriJobsApi },
  ],
};
