import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';

export interface PanelSummary {
  /** Bytes of the marked files. */
  readonly markedSize: number;
  /** Bytes of all files. */
  readonly totalSize: number;
  readonly markedFiles: number;
  readonly files: number;
  readonly markedDirs: number;
  readonly dirs: number;
}

/**
 * Numbers of the status line (`docs/ui-layout.md`, row 4). Folders count as
 * folders, everything else (incl. symlinks to files and unreadable entries)
 * as files; folder sizes are summed once calculated. The `..` row never counts.
 */
export function summarize(entries: readonly DirEntry[], marked: ReadonlySet<string>): PanelSummary {
  let markedSize = 0;
  let totalSize = 0;
  let markedFiles = 0;
  let files = 0;
  let markedDirs = 0;
  let dirs = 0;
  for (const e of entries) {
    const isMarked = marked.has(e.path);
    if (isParentRow(e)) {
      continue;
    }
    if (isNavigableDir(e)) {
      dirs++;
      // folder sizes count once calculated (Space, design 003 E7)
      totalSize += e.size ?? 0;
      if (isMarked) {
        markedDirs++;
        markedSize += e.size ?? 0;
      }
    } else {
      files++;
      const size = e.size ?? 0;
      totalSize += size;
      if (isMarked) {
        markedFiles++;
        markedSize += size;
      }
    }
  }
  return { markedSize, totalSize, markedFiles, files, markedDirs, dirs };
}
