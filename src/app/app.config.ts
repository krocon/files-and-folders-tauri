import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { FsApi, TauriFsApi } from './core/fs/fs-api';
import { SessionApi, TauriSessionApi } from './core/session/session-api';
import { KeymapApi, TauriKeymapApi } from './core/actions/keymap-api';
import { JobsApi, TauriJobsApi } from './core/jobs/jobs-api';
import { RenameApi, TauriRenameApi } from './core/rename/rename-api';
import { FoldersApi, TauriFoldersApi } from './core/folders/folders-api';
import { PreviewApi, TauriPreviewApi } from './core/preview/preview-api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: FsApi, useClass: TauriFsApi },
    { provide: SessionApi, useClass: TauriSessionApi },
    { provide: KeymapApi, useClass: TauriKeymapApi },
    { provide: JobsApi, useClass: TauriJobsApi },
    { provide: RenameApi, useClass: TauriRenameApi },
    { provide: FoldersApi, useClass: TauriFoldersApi },
    { provide: PreviewApi, useClass: TauriPreviewApi },
  ],
};
