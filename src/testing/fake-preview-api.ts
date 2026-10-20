import { PreviewApi } from '../app/core/preview/preview-api';
import {
  Format,
  Preview,
  PreviewOptions,
  Properties,
  TextPreview,
} from '../app/core/preview/preview.models';

export const TEXT_FORMAT: Format = {
  id: 'text',
  label: 'Text',
  mime: 'text/plain',
  family: 'text',
  displayableImage: false,
};

export function textPreview(text: string, patch: Partial<TextPreview> = {}): TextPreview {
  return {
    kind: 'text',
    size: text.length,
    format: TEXT_FORMAT,
    extMismatch: false,
    encoding: 'utf-8',
    text,
    truncated: false,
    lossy: false,
    ...patch,
  };
}

/**
 * In-memory PreviewApi: `previews` by path (default: a text with the path),
 * `hold` keeps answers pending until `release()` (stale-answer tests).
 */
export class FakePreviewApi extends PreviewApi {
  readonly reads: { path: string; options: PreviewOptions }[] = [];
  readonly propertyReads: string[] = [];
  readonly previews = new Map<string, Preview>();
  properties: (path: string) => Properties = (path) => ({
    name: path,
    path,
    kind: 'file',
    targetKind: null,
    linkTarget: null,
    size: 1,
    createdMs: null,
    modifiedMs: 0,
    accessedMs: null,
    readonly: false,
    format: TEXT_FORMAT,
    unix: { mode: 0o644, uid: 1, gid: 1, owner: 'u', group: 'g', flagsHidden: null },
    windows: null,
  });
  hold = false;
  private held: (() => void)[] = [];

  readPreview(path: string, options: PreviewOptions = {}): Promise<Preview> {
    this.reads.push({ path, options });
    const result = this.previews.get(path) ?? textPreview(`content of ${path}`);
    if (!this.hold) {
      return Promise.resolve(result);
    }
    return new Promise((resolve) => this.held.push(() => resolve(result)));
  }

  release(order: 'fifo' | 'lifo' = 'fifo'): void {
    const list = order === 'fifo' ? this.held : [...this.held].reverse();
    this.held = [];
    list.forEach((f) => f());
  }

  getProperties(path: string): Promise<Properties> {
    this.propertyReads.push(path);
    return Promise.resolve(this.properties(path));
  }

  imageUrl(token: string): string {
    return `fnfpreview://localhost/${token}`;
  }
}
