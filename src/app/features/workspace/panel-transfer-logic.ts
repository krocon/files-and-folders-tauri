import { DirEntry, isNavigableDir, isVirtualPath } from '../../core/fs/fs.models';
import { isArchiveEntry } from '../../core/archive/archive-names';

/** Where the panel stands (design 040): what may open in the other side. */
export interface TransferContext {
  /** Folder the active side works in (`WorkspaceStore.actionDir`), null if none. */
  readonly folder: string | null;
  /** The panel shows the inside of an archive (an archive in it does not open, 016 E3.4). */
  readonly inArchive: boolean;
  /** The panel shows a server folder (archives there are files, 034 §4.6). */
  readonly onServer: boolean;
}

/**
 * Total Commander Ctrl+←/→ (design 040): the folder (also "..") or archive under the
 * cursor opens in the named side; on a file – or anything that cannot be opened
 * as a folder – the folder the active side shows. Null when there is nothing to open.
 * Paths stay opaque: the entry's path comes from Rust as it is.
 */
export function transferPath(entry: DirEntry | undefined, ctx: TransferContext): string | null {
  if (entry && !entry.lossyName && !isVirtualPath(entry.path)) {
    const archive = isArchiveEntry(entry) && !ctx.inArchive && !ctx.onServer;
    if (isNavigableDir(entry) || archive) {
      return entry.path;
    }
  }
  return ctx.folder;
}
