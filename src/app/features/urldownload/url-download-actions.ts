import { ActionService } from '../../core/actions/action.service';
import { UrlDownloadStore } from './url-download.store';

/**
 * Action of "Download from URLs" (design 078 E-h). Off when neither side shows a local
 * folder. The category `files` keeps it vetoed right after an MCP client changed the
 * view (design 071) – and no MCP tool can start the job at all.
 */
export function registerUrlDownloadActions(
  actions: ActionService,
  store: UrlDownloadStore,
): () => void {
  return actions.register({
    OPEN_URL_DOWNLOAD_DLG: { enabled: () => store.canOpen(), run: () => store.open() },
  });
}
