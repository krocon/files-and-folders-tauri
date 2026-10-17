import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { FsApi, TauriFsApi } from './core/fs/fs-api';
import { SessionApi, TauriSessionApi } from './core/session/session-api';
import { KeymapApi, TauriKeymapApi } from './core/actions/keymap-api';
import { JobsApi, TauriJobsApi } from './core/jobs/jobs-api';
import { RenameApi, TauriRenameApi } from './core/rename/rename-api';
import { FoldersApi, TauriFoldersApi } from './core/folders/folders-api';
import { OsApi, TauriOsApi } from './core/os/os-api';
import { ClipboardApi, WebClipboardApi } from './core/os/clipboard';
import { PreviewApi, TauriPreviewApi } from './core/preview/preview-api';
import { TauriWatchApi, WatchApi } from './core/watch/watch-api';
import { DragDropApi, TauriDragDropApi } from './core/dnd/drag-drop-api';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: FsApi, useClass: TauriFsApi },
    { provide: SessionApi, useClass: TauriSessionApi },
    { provide: KeymapApi, useClass: TauriKeymapApi },
    { provide: JobsApi, useClass: TauriJobsApi },
    { provide: RenameApi, useClass: TauriRenameApi },
    { provide: FoldersApi, useClass: TauriFoldersApi },
    { provide: OsApi, useClass: TauriOsApi },
    { provide: ClipboardApi, useClass: WebClipboardApi },
    { provide: PreviewApi, useClass: TauriPreviewApi },
    { provide: WatchApi, useClass: TauriWatchApi },
    { provide: DragDropApi, useClass: TauriDragDropApi },
  ],
};
