import { ActionService } from '../../core/actions/action.service';
import { ChecksumStore } from './checksum.store';

/** Checksum actions (design 039). */
export function registerChecksumActions(actions: ActionService, cs: ChecksumStore): () => void {
  return actions.register({
    OPEN_CHECKSUM_CREATE_DLG: { enabled: () => cs.hasFolder(), run: () => cs.open() },
    CHECKSUM_VERIFY: { enabled: () => cs.cursorList() !== null, run: () => cs.verify() },
    COPY_CHECKSUM: { enabled: () => cs.cursorFile() !== null, run: () => cs.copyDigest() },
  });
}
