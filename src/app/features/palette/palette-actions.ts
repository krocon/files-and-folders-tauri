import { ActionId } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { HitAction, PaletteStore } from './palette.store';

/**
 * The actions on palette hits (design 043 E4). They are catalog actions, enabled only
 * while the palette shows a hit; their keys are those of the panel actions in `via`
 * (F5 copies the hit as it copies the cursor entry – one keymap, also for overrides).
 */
export const HIT_ACTIONS: readonly {
  readonly action: HitAction;
  readonly id: ActionId;
  readonly via: readonly ActionId[];
}[] = [
  { action: 'open', id: 'PALETTE_OPEN_HIT', via: ['NAVIGATE_OPEN'] },
  { action: 'preview', id: 'PALETTE_PREVIEW_HIT', via: ['OPEN_VIEW_DLG', 'QUICK_VIEW'] },
  { action: 'reveal', id: 'PALETTE_REVEAL_HIT', via: ['GOTO_FILE'] },
  { action: 'revealInNewTab', id: 'PALETTE_REVEAL_IN_NEW_TAB', via: ['OPEN_IN_NEW_TAB'] },
  { action: 'copy', id: 'PALETTE_COPY_HIT', via: ['OPEN_COPY_DLG'] },
  { action: 'move', id: 'PALETTE_MOVE_HIT', via: ['OPEN_MOVE_DLG'] },
  { action: 'rename', id: 'PALETTE_RENAME_HIT', via: ['OPEN_RENAME_DLG', 'RENAME_INLINE'] },
  { action: 'similar', id: 'PALETTE_SIMILAR_HIT', via: ['OPEN_FIND_DUPLICATES_DLG'] },
  { action: 'analyzeParent', id: 'PALETTE_ANALYZE_PARENT', via: ['OPEN_DISK_USAGE'] },
  { action: 'mark', id: 'PALETTE_MARK_HIT', via: ['TOGGLE_MARK_AND_ADVANCE', 'TOGGLE_MARK'] },
  { action: 'resultsTab', id: 'PALETTE_RESULTS_TAB', via: ['OPEN_FIND_DLG'] },
];

export const HIT_ACTION_IDS: ReadonlySet<ActionId> = new Set(HIT_ACTIONS.map((a) => a.id));

/** The hit action a panel action's key stands for in the palette (`null`: none). */
export function hitActionFor(id: ActionId): HitAction | null {
  return HIT_ACTIONS.find((a) => a.id === id || a.via.includes(id))?.action ?? null;
}

export function registerPaletteActions(
  actions: ActionService,
  palette: PaletteStore,
  dialogs: DialogService,
): () => void {
  const open = () => dialogs.open() === 'palette';
  return actions.register(
    Object.fromEntries(
      HIT_ACTIONS.map((a) => [
        a.id,
        { enabled: () => open() && palette.can(a.action), run: () => palette.runAction(a.action) },
      ]),
    ),
  );
}
