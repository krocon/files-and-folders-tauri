import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { ConfigApi } from '../../core/config/config-api';
import { ButtonSetsOverride } from '../../core/config/config.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { BUTTON_SETS } from '../workspace/button-bar/button-config';
import { ButtonSets, minimalOverride, resolveButtonSets } from './button-config-logic';
import { CONFIG_TEXTS, describeConfigWarning } from './config-texts';

/**
 * The button bar's sets (root, design 022 E1): built in + the user's `buttons.json`.
 * The bar reads {@link sets}; the dialog saves through {@link save}.
 */
@Injectable({ providedIn: 'root' })
export class ButtonConfigStore {
  private readonly api = inject(ConfigApi);
  private readonly actions = inject(ActionService);

  readonly builtIn: ButtonSets = BUTTON_SETS;
  /** The sets of the user file as loaded/saved. */
  readonly override = signal<ButtonSetsOverride>({});
  private readonly resolved = computed(() => resolveButtonSets(this.builtIn, this.override()));
  readonly sets = computed(() => this.resolved().sets);
  /** Ids of the file that the catalog does not know (dropped). */
  readonly unknown = computed(() => this.resolved().unknown);
  /** Number of sets that differ from the built-in ones. */
  readonly changedCount = computed(
    () => Object.keys(minimalOverride(this.builtIn, this.sets())).length,
  );

  async init(): Promise<void> {
    try {
      const loaded = await this.api.loadButtons();
      this.override.set(loaded.value.sets ?? {});
      if (loaded.warning) {
        this.actions.report(describeConfigWarning('buttons', loaded.warning));
      }
    } catch (err) {
      this.actions.report(CONFIG_TEXTS.loadFailed('buttons', errorText(toFsError(err))));
    }
    if (this.unknown().length > 0) {
      this.actions.report(CONFIG_TEXTS.unknownIds(this.unknown().join(', ')));
    }
  }

  /** Writes the sets (only those that differ from the built-in ones); rejects with an `FsError`. */
  async save(sets: ButtonSets): Promise<void> {
    const next = minimalOverride(this.builtIn, sets);
    await this.api.saveButtons(next);
    this.override.set(next);
  }
}
