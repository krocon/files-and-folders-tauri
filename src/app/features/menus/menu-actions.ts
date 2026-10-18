import { ActionService } from '../../core/actions/action.service';
import { MenuService } from './menu.service';

/** Handlers of the menu actions (design 014 E9). Returns the unregister function. */
export function registerMenuActions(actions: ActionService, menus: MenuService): () => void {
  return actions.register({
    OPEN_CONTEXT_MENU: { run: () => menus.openAtCursor() },
    FOCUS_MENU_BAR: {
      run: () => menus.focusMenuBar(),
      enabled: () => menus.canFocusMenuBar(),
    },
    QUIT_APP: { run: () => menus.quit() },
  });
}
