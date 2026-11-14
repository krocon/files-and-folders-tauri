import { AreaIdent, AreaModelIf, CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import { OverviewItem } from '../../core/imageoverview/image-overview.models';

/** What the renderer asks the grid (design 074 E11). */
export interface TileContext {
  /** `src` of the item's thumbnail, `null` = placeholder (failed, waiting for a retry). */
  src(item: OverviewItem): string | null;
  /** The thumbnail could not be loaded. */
  failed(item: OverviewItem): void;
  isCursor(item: OverviewItem): boolean;
  isMarked(item: OverviewItem): boolean;
  /** Tooltip (name with the relative path, size) – the tile itself shows no text. */
  title(item: OverviewItem): string;
  /** Text of a tile without a picture. */
  noPreview(): string;
}

/**
 * One tile in a cell of the GuiExpert cover grid (design 074 E2/E11, as Comic Commander's
 * `CoverRenderer`): plain DOM, no Angular. Only the picture – the name is the tooltip. File names are user data – only `textContent` and
 * attributes, never `innerHTML`. A picture that cannot be loaded shows the extension and
 * "no preview"; the grid asks for it again a few times (`TileRetries`).
 */
export class TileRenderer implements CellRendererIf {
  constructor(private readonly ctx: TileContext) {}

  render(
    cellDiv: HTMLDivElement,
    rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    areaModel: AreaModelIf,
    cellValue: unknown,
  ): RendererCleanupFnType | undefined {
    const item = cellValue as OverviewItem | undefined;
    if (!item) {
      return undefined; // the cells after the last image are empty
    }
    const doc = cellDiv.ownerDocument;
    const tile = doc.createElement('div');
    tile.className = 'io-tile';
    // row 0 is higher by the header lying over it (`firstRowPaddingTop`): the tile at its bottom
    const inset = rowIndex === 0 ? firstRowInset(areaModel) : 0;
    if (inset > 0) {
      tile.style.top = `${inset + 3}px`; // 3px = the gap of `.io-tile`
    }
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
      showPlaceholder();
      this.ctx.failed(item);
    };
    if (item.kind === 'unsupported' || src === null) {
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
    if (marked) {
      const badge = doc.createElement('span');
      badge.className = 'io-check';
      const check = doc.createElement('i');
      check.className = 'fa fa-check';
      check.setAttribute('aria-hidden', 'true');
      badge.appendChild(check);
      tile.appendChild(badge);
    }
    cellDiv.appendChild(tile);
    return () => img?.removeEventListener('error', onError);
  }
}

function firstRowInset(model: AreaModelIf): number {
  const pad = (model as { firstRowPaddingTop?: unknown }).firstRowPaddingTop;
  return typeof pad === 'number' && pad > 0 ? pad : 0;
}
