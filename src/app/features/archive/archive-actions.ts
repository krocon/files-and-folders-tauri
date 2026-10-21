import { ActionId } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { ArchiveStore } from './archive.store';
import { ARCHIVE_TEXTS } from './archive-texts';

/**
 * Actions that need a real folder or real files: off while the active panel
 * shows a folder inside an archive (read-only, virtual paths – design 016 E1).
 * Copy (= extract), marking, navigation, clipboard names stay; F3 and the quick
 * view work on a copy in the view cache (design 025 E5/E10).
 */
export const OFF_IN_ARCHIVE: ReadonlySet<ActionId> = new Set<ActionId>([
  'OPEN_EDIT_DLG',
  'OPEN_ATTRIBUTE_DLG',
  'OPEN_CHANGE_ATTRIBUTES_DLG',
  'OPEN_TOOLS_DLG',
  'REVEAL_IN_FILE_MANAGER',
  'OPEN_TERMINAL_HERE',
  'CALC_DIR_SIZES',
  'OPEN_CREATE_FILE_DLG',
  'OPEN_MKDIR_DLG',
  'OPEN_RENAME_DLG',
  'RENAME_INLINE',
  'OPEN_MOVE_DLG',
  'OPEN_DELETE_DLG',
  'DELETE_PERMANENT',
  'OPEN_PACK_DLG',
  'OPEN_MULTIRENAME_DLG',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_FIND_DLG',
  'OPEN_FOLDER_FINDER_DLG',
  'OPEN_FIND_DUPLICATES_DLG',
  'COMPARE_FILES',
  'OPEN_CHECKSUM_CREATE_DLG',
  'CHECKSUM_VERIFY',
  'COPY_CHECKSUM',
]);

/** Pack, unpack and duplicate actions (design 016 E7). */
export function registerArchiveActions(
  actions: ActionService,
  archive: ArchiveStore,
  dup: DuplicatesStore,
): () => void {
  const unveto = actions.setVeto((id) =>
    archive.inArchive() && (id === null || OFF_IN_ARCHIVE.has(id)) ? ARCHIVE_TEXTS.readOnly : null,
  );
  const unregister = actions.register({
    OPEN_PACK_DLG: { enabled: () => archive.canPack(), run: () => archive.openPack() },
    OPEN_UNPACK_DLG: { enabled: () => archive.canUnpack(), run: () => archive.openUnpack() },
    OPEN_FIND_DUPLICATES_DLG: { enabled: () => dup.canOpen(), run: () => dup.open() },
    DUP_MARK_KEEP_NEWEST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('newest') },
    DUP_MARK_KEEP_OLDEST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('oldest') },
    DUP_MARK_KEEP_FIRST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('first') },
  });
  return () => {
    unregister();
    unveto();
  };
}
