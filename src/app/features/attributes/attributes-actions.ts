import { ActionService } from '../../core/actions/action.service';
import { AttributesStore } from './attributes.store';

/**
 * Change attributes as an action (design 024 E1). Off inside archives
 * (`OFF_IN_ARCHIVE`) and on unchecked listings (`OFF_WHILE_UNCHECKED`).
 */
export function registerAttributesActions(
  actions: ActionService,
  attrs: AttributesStore,
): () => void {
  return actions.register({
    OPEN_CHANGE_ATTRIBUTES_DLG: { enabled: () => attrs.canOpen(), run: () => attrs.open() },
  });
}
