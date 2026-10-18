import { ActionService } from '../../core/actions/action.service';
import { ThemeService } from '../../core/theme/theme.service';
import { DialogService } from '../../shared/dialog/dialog.service';

/** Colour scheme actions (design 013 E3). */
export function registerThemeActions(
  actions: ActionService,
  theme: ThemeService,
  dialogs: DialogService,
): () => void {
  return actions.register({
    OPEN_THEMES_DLG: { run: () => dialogs.show('themes') },
    NEXT_THEME: { run: () => theme.next() },
    THEME_FOLLOW_SYSTEM: { run: () => theme.followSystem() },
  });
}
