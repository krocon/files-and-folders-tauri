import { Injectable, signal } from '@angular/core';

export type DialogKind =
  | 'palette'
  | 'call-action'
  | 'mark-pattern'
  | 'unmark-pattern'
  | 'shortcuts'
  | 'confirm'
  | 'jobs'
  | 'conflict'
  | 'copy-move'
  | 'delete'
  | 'name'
  | 'multi-rename'
  | 'group-files'
  | 'clean-folders'
  | 'multi-mkdir'
  | 'tools'
  | 'tool-config'
  | 'viewer'
  | 'properties'
  | 'attributes'
  | 'find'
  | 'folder-finder'
  | 'pack'
  | 'unpack'
  | 'duplicates'
  | 'themes'
  | 'settings'
  | 'about'
  | 'button-config'
  | 'file-types'
  | 'mr-import';

/**
 * Which modal dialog is open (one at a time). While one is open, the keyboard
 * dispatcher leaves all keys to it. Remembers and restores the focus.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly open = signal<DialogKind | null>(null);
  private returnFocus: HTMLElement | null = null;

  show(kind: DialogKind): void {
    if (this.open() === null) {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      this.returnFocus = active instanceof HTMLElement ? active : null;
    }
    this.open.set(kind);
  }

  close(options?: { restoreFocus?: boolean }): void {
    this.open.set(null);
    const target = options?.restoreFocus === false ? null : this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) {
      setTimeout(() => target.focus());
    }
  }
}
