import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { UpdateStore } from './update.store';

/** Opens the update dialog and starts a check (design 075). */
export function openUpdateCheck(store: UpdateStore, dialogs: DialogService): void {
  void store.check();
  dialogs.show('update');
}

/** Shows the result the automatic check found (hint "Details…"), without a new request. */
export function openUpdateHint(store: UpdateStore, dialogs: DialogService): void {
  if (store.showHint()) {
    dialogs.show('update');
  }
}

/** CHECK_FOR_UPDATES (075 E11) – menu Help / macOS app menu, palette, About. */
export function registerUpdateActions(
  actions: ActionService,
  store: UpdateStore,
  dialogs: DialogService,
): () => void {
  return actions.register({
    CHECK_FOR_UPDATES: { run: () => openUpdateCheck(store, dialogs) },
  });
}
