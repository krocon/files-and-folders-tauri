import { ActionService } from '../../core/actions/action.service';
import { THEME_CHOICE_LABELS, ThemeService } from '../../core/theme/theme.service';
import { THEME_TEXTS } from './theme-texts';
import { DialogService } from '../../shared/dialog/dialog.service';

/** Colour scheme actions (design 013 E3). */
export function registerThemeActions(
  actions: ActionService,
  theme: ThemeService,
  dialogs: DialogService,
): () => void {
  THEME_CHOICE_LABELS.follow = () => THEME_TEXTS.menuFollow;
  return actions.register({
    OPEN_THEMES_DLG: { run: () => dialogs.show('themes') },
    OPEN_THEME_PICKER: { run: () => dialogs.show('theme-picker') },
    NEXT_THEME: { run: () => theme.next() },
    THEME_FOLLOW_SYSTEM: { run: () => theme.followSystem() },
  });
}
