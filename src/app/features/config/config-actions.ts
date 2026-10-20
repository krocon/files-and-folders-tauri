import { ActionService } from '../../core/actions/action.service';
import { MenuApi } from '../../core/menu/menu-api';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CONFIG_TEXTS } from './config-texts';

/** Handlers of design 022: the two configuration dialogs and full screen (J14). */
export function registerConfigActions(
  actions: ActionService,
  dialogs: DialogService,
  menu: MenuApi,
): () => void {
  return actions.register({
    OPEN_BUTTON_CONFIG_DLG: { run: () => dialogs.show('button-config') },
    OPEN_FILETYPE_CONFIG_DLG: { run: () => dialogs.show('file-types') },
    TOGGLE_FULLSCREEN: {
      run: async () => {
        try {
          await menu.toggleFullscreen();
        } catch (err) {
          actions.report(CONFIG_TEXTS.fullscreenFailed(errorText(toFsError(err))));
        }
      },
    },
  });
}
