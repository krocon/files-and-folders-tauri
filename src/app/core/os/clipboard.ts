import { Injectable } from '@angular/core';
import { DirEntry } from '../fs/fs.models';

export type ClipboardWhat = 'names' | 'paths';
export type ClipboardFormat = 'lines' | 'json';

/**
 * Text for "copy names / paths" (design 011 E5): one line per entry, or a JSON
 * array of strings (2 spaces). Folders included, `..` never (done by the caller's
 * selection). Order as given (= the list's display order).
 */
export function clipboardText(
  entries: readonly DirEntry[],
  what: ClipboardWhat,
  format: ClipboardFormat,
): string {
  const values = entries.map((e) => (what === 'names' ? e.name : e.path));
  return format === 'json' ? JSON.stringify(values, null, 2) : values.join('\n');
}

/** Writes text to the system clipboard (no plugin: the webview can do it, design 011 E5). */
@Injectable({ providedIn: 'root', useFactory: () => new WebClipboardApi() })
export abstract class ClipboardApi {
  abstract writeText(text: string): Promise<void>;
}

@Injectable()
export class WebClipboardApi extends ClipboardApi {
  async writeText(text: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // not allowed here (no secure context / no user gesture) – try the old way
    }
    if (!copyWithTextarea(text)) {
      throw { code: 'io', message: 'The clipboard is not available', path: null };
    }
  }
}

function copyWithTextarea(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus?.();
  return ok;
}
