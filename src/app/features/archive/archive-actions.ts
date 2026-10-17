import { ActionService } from '../../core/actions/action.service';
import { DuplicatesStore } from '../duplicates/duplicates.store';
import { ArchiveStore } from './archive.store';

/** Pack, unpack and duplicate actions (design 016 E7). */
export function registerArchiveActions(
  actions: ActionService,
  archive: ArchiveStore,
  dup: DuplicatesStore,
): () => void {
  return actions.register({
    OPEN_PACK_DLG: { enabled: () => archive.canPack(), run: () => archive.openPack() },
    OPEN_UNPACK_DLG: { enabled: () => archive.canUnpack(), run: () => archive.openUnpack() },
    OPEN_FIND_DUPLICATES_DLG: { enabled: () => dup.canOpen(), run: () => dup.open() },
    DUP_MARK_KEEP_NEWEST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('newest') },
    DUP_MARK_KEEP_OLDEST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('oldest') },
    DUP_MARK_KEEP_FIRST: { enabled: () => dup.canMark(), run: () => dup.markAllBut('first') },
  });
}
