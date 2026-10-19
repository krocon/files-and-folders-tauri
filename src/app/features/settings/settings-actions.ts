import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';

/** Settings… (Mod+,) – design 015; About… is registered by 017 (`about-actions.ts`). Returns the unregister function. */
export function registerSettingsActions(
  actions: ActionService,
  dialogs: DialogService,
): () => void {
  return actions.register({
    OPEN_SETUP_DLG: { run: () => dialogs.show('settings') },
  });
}
