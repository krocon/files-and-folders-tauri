import { DiffRow } from '../../core/diff/diff.models';
import { DirEntry, isParentRow, isVirtualPath } from '../../core/fs/fs.models';
import { Side } from '../../core/session/session.models';

/** What one panel offers to "compare files" (design 037). */
export interface ComparePanel {
  readonly side: Side;
  readonly marked: readonly DirEntry[];
  readonly cursor: DirEntry | null;
}

export type ComparePick =
  | { readonly left: DirEntry; readonly right: DirEntry }
  | { readonly problem: 'twoMarked' | 'noOtherFile' | 'notFiles' | 'same' };

export function isComparableFile(e: DirEntry | null | undefined): e is DirEntry {
  return (
    !!e &&
    !isParentRow(e) &&
    !isVirtualPath(e.path) &&
    !e.lossyName &&
    (e.kind === 'file' || (e.kind === 'symlink' && e.targetKind === 'file'))
  );
}

/**
 * Which two files to compare (Total Commander "Compare by content"): exactly two
 * marked files of the active side; otherwise the file under the cursor (or the one
 * marked) of the active side against the cursor file of the other side – the left
 * panel's file is shown left.
 */
export function pickFiles(active: ComparePanel, other: ComparePanel | null): ComparePick {
  const marked = active.marked.filter((e) => !isParentRow(e));
  if (marked.length === 2) {
    return marked.every(isComparableFile)
      ? { left: marked[0], right: marked[1] }
      : { problem: 'notFiles' };
  }
  if (marked.length > 2) {
    return { problem: 'twoMarked' };
  }
  const mine = marked[0] ?? active.cursor;
  const theirs = other?.cursor ?? null;
  if (!isComparableFile(mine)) {
    return { problem: 'notFiles' };
  }
  if (!isComparableFile(theirs)) {
    return { problem: 'noOtherFile' };
  }
  if (mine.path === theirs.path) {
    return { problem: 'same' };
  }
  return active.side === 'left' ? { left: mine, right: theirs } : { left: theirs, right: mine };
}

/** Rows where a block of differences starts (for next / previous difference). */
export function changeStarts(rows: readonly DiffRow[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    const changed = r.kind !== 'equal' && r.kind !== 'skip';
    const prev = rows[i - 1];
    if (changed && (!prev || prev.kind === 'equal' || prev.kind === 'skip')) {
      out.push(i);
    }
  });
  return out;
}

/** Text for a grid cell: tabs as four spaces, spaces kept (no collapsing in HTML). */
export function cellText(text: string): string {
  return text.replace(/\t/g, '    ').replace(/ /g, ' ');
}

/** Hex lines of a binary window, offsets absolute (`base`), 16 bytes per line. */
export function hexLines(bytes: readonly number[], base: number): string[] {
  const out: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.slice(off, off + 16);
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    out.push(`${(base + off).toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
  }
  return out;
}
