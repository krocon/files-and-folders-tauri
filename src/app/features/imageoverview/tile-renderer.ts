import { AreaIdent, AreaModelIf, CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import { OverviewItem } from '../../core/imageoverview/image-overview.models';

/** What the renderer asks the grid (design 074 E11). */
export interface TileContext {
  /** Thumbnail URL of the item. */
  src(item: OverviewItem): string;
  isCursor(item: OverviewItem): boolean;
  isMarked(item: OverviewItem): boolean;
  /** Height of the picture part of a tile (px). */
  pictureHeight(): number;
  /** Tooltip (relative path, size). */
  title(item: OverviewItem): string;
  /** Text of a tile without a picture. */
  noPreview(): string;
}

/** Failed URLs remembered at most (errors are final: Rust remembers them too). */
const MAX_FAILED = 20_000;

/**
 * One tile in a cell of the GuiExpert cover grid (design 074 E2/E11, as Comic Commander's
 * `CoverRenderer`): plain DOM, no Angular. File names are user data – only `textContent` and
 * attributes, never `innerHTML`. A picture that cannot be made (415/422/404) shows the
 * extension and "no preview" instead; the URL is not asked for again.
 */
export class TileRenderer implements CellRendererIf {
  private readonly failed = new Set<string>();

  constructor(private readonly ctx: TileContext) {}

  render(
    cellDiv: HTMLDivElement,
    _rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    _areaModel: AreaModelIf,
    cellValue: unknown,
  ): RendererCleanupFnType | undefined {
    const item = cellValue as OverviewItem | undefined;
    if (!item) {
      return undefined; // the cells after the last image are empty
    }
    const doc = cellDiv.ownerDocument;
    const tile = doc.createElement('div');
    tile.className = 'io-tile';
    if (this.ctx.isCursor(item)) {
      tile.classList.add('io-cursor');
    }
    const marked = this.ctx.isMarked(item);
    if (marked) {
      tile.classList.add('io-marked');
    }
    tile.title = this.ctx.title(item);
    const picture = doc.createElement('div');
    picture.className = 'io-picture';
    picture.style.height = `${this.ctx.pictureHeight()}px`;
    const src = this.ctx.src(item);
    let img: HTMLImageElement | null = null;
    const showPlaceholder = () => {
      img?.remove();
      img = null;
      const ph = doc.createElement('span');
      ph.className = 'io-placeholder';
      const ext = doc.createElement('b');
      const dot = item.name.lastIndexOf('.');
      ext.textContent = dot > 0 ? item.name.slice(dot + 1).toUpperCase() : '?';
      ph.appendChild(ext);
      ph.appendChild(doc.createTextNode(this.ctx.noPreview()));
      picture.appendChild(ph);
    };
    const onError = () => {
      if (this.failed.size >= MAX_FAILED) {
        this.failed.clear();
      }
      this.failed.add(src);
      showPlaceholder();
    };
    if (item.kind === 'unsupported' || this.failed.has(src)) {
      showPlaceholder();
    } else {
      img = doc.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('error', onError, { once: true });
      img.src = src;
      picture.appendChild(img);
    }
    tile.appendChild(picture);
    const name = doc.createElement('span');
    name.className = 'io-name';
    if (marked) {
      const check = doc.createElement('i');
      check.className = 'fa fa-check';
      check.setAttribute('aria-hidden', 'true');
      name.appendChild(check);
    }
    name.appendChild(doc.createTextNode(item.name));
    tile.appendChild(name);
    cellDiv.appendChild(tile);
    return () => img?.removeEventListener('error', onError);
  }
}
