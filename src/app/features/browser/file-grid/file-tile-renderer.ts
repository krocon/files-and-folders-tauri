import { CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import {
  iconColorGroupForEntry,
  iconNameForEntry,
} from '../../../core/file-icon/file-icon.service';
import { DirEntry } from '../../../core/fs/fs.models';
import { displayName } from '../file-list/file-renderers';
import { GridMode } from './grid-logic';

/** What a tile asks the grid at paint time (design 041 E5/E6). */
export interface FileTileContext {
  mode(): GridMode;
  cols(): number;
  pictureHeight(): number;
  isCursor(entry: DirEntry): boolean;
  isMarked(entry: DirEntry): boolean;
  isDropTarget(entry: DirEntry): boolean;
  /** `src` of the entry's thumbnail, null = show the icon. */
  thumb(entry: DirEntry): string | null;
  /** The thumbnail could not be loaded. */
  thumbFailed(entry: DirEntry): void;
  /** Screen-reader text of a marked entry. */
  markedText(): string;
}

/** Attribute of a tile with the index of its entry (drag and drop, context menu). */
export const TILE_INDEX_ATTR = 'data-fnf-tile';

/**
 * One entry as a tile of the cover grid: plain DOM, no Angular. It carries the row
 * classes of the list (`fnf-cursor`, `fnf-marked`, `fnf-hidden` …), so the colours of
 * every scheme apply unchanged. File names are user data: text nodes only.
 */
export class FileTileRenderer implements CellRendererIf {
  constructor(private readonly ctx: FileTileContext) {}

  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    columnIndex: number,
    _areaIdent: unknown,
    _areaModel: unknown,
    cellValue: unknown,
  ): RendererCleanupFnType | undefined {
    const entry = cellValue as DirEntry | undefined;
    if (!entry) {
      return undefined; // the cells behind the last entry
    }
    const doc = cellDiv.ownerDocument;
    const thumbs = this.ctx.mode() === 'thumbnails';
    const tile = doc.createElement('div');
    tile.className = thumbs ? 'fg-tile fg-thumb' : 'fg-tile fg-brief';
    tile.setAttribute(TILE_INDEX_ATTR, String(rowIndex * this.ctx.cols() + columnIndex));
    const marked = this.ctx.isMarked(entry);
    const add = (on: boolean, cls: string) => on && tile.classList.add(cls);
    add(this.ctx.isCursor(entry), 'fnf-cursor');
    add(marked, 'fnf-marked');
    add(this.ctx.isDropTarget(entry), 'fnf-drop-target');
    add(entry.hidden, 'fnf-hidden');
    add(entry.kind === 'symlink', 'fnf-symlink');
    add(entry.kind === 'unknown', 'fnf-unreadable');
    tile.title = entry.name;

    const icon = () => {
      const span = doc.createElement('span');
      span.className = 'fnf-icon';
      span.setAttribute('aria-hidden', 'true');
      const i = doc.createElement('i');
      i.className = `fa ${marked && !thumbs ? 'fa-check' : iconNameForEntry(entry)}`;
      span.appendChild(i);
      const group = iconColorGroupForEntry(entry);
      if (group && !(marked && !thumbs)) {
        span.classList.add(`fnf-icon-${group}`);
      }
      return span;
    };

    let cleanup: RendererCleanupFnType | undefined;
    if (thumbs) {
      const picture = doc.createElement('div');
      picture.className = 'fg-picture';
      picture.style.height = `${this.ctx.pictureHeight()}px`;
      const src = this.ctx.thumb(entry);
      if (src === null) {
        picture.appendChild(icon());
      } else {
        const img = doc.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        const onError = () => {
          img.remove();
          picture.appendChild(icon());
          this.ctx.thumbFailed(entry);
        };
        img.addEventListener('error', onError, { once: true });
        img.src = src;
        picture.appendChild(img);
        cleanup = () => img.removeEventListener('error', onError);
      }
      tile.appendChild(picture);
      if (marked) {
        const badge = doc.createElement('span');
        badge.className = 'fg-check';
        badge.setAttribute('aria-hidden', 'true');
        const check = doc.createElement('i');
        check.className = 'fa fa-check';
        badge.appendChild(check);
        tile.appendChild(badge);
      }
    } else {
      tile.appendChild(icon());
    }
    if (marked) {
      const sr = doc.createElement('span');
      sr.className = 'ge-table-sr-only';
      sr.textContent = this.ctx.markedText();
      tile.appendChild(sr);
    }
    const name = doc.createElement('span');
    name.className = 'fg-name';
    name.textContent = displayName(entry);
    tile.appendChild(name);
    cellDiv.appendChild(tile);
    return cleanup;
  }
}
