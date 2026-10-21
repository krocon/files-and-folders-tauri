import { ActionService } from '../../core/actions/action.service';
import { MenuService } from '../menus/menu.service';
import { StarterStore } from './starter.store';

/** The actions of design 032. The entries themselves are extra actions (`StarterStore`). */
export function registerStarterActions(
  actions: ActionService,
  starter: StarterStore,
  menus: MenuService,
): () => void {
  return actions.register({
    OPEN_STARTER_MENU: { run: () => menus.openStarter() },
    OPEN_STARTER_CONFIG_DLG: { run: () => starter.openEditor() },
  });
}
