import { ArchivePasswordPrompt, isPasswordError } from '../../core/archive/archive-password-prompt';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
import { PreviewApi } from '../../core/preview/preview-api';
import { EncodingId, Preview } from '../../core/preview/preview.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { PreviewContext } from './preview-providers';
import { findMatches, MAX_MATCHES, splitLines, stepMatch } from './text-search';

/** A file the viewer can show (also a link to a file). */
export function isViewableFile(e: DirEntry): boolean {
  return (
    !isParentRow(e) && (e.kind === 'file' || (e.kind === 'symlink' && e.targetKind === 'file'))
  );
}

export type ViewMode = 'auto' | 'text' | 'hex';
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8] as const;

/**
 * The viewer (F3, design 010 E1/E8): the file under the cursor of the active
 * panel, ←/→ through the files of that panel (the panel cursor follows),
 * encoding/mode/wrap, search. Stale answers are dropped (request sequence).
 */
@Injectable({ providedIn: 'root' })
export class ViewerStore {
  private readonly api = inject(PreviewApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly dialogs = inject(DialogService);
  private readonly passwordPrompt = inject(ArchivePasswordPrompt);

  readonly side = signal<Side | null>(null);
  readonly entry = signal<DirEntry | null>(null);
  readonly preview = signal<Preview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly encoding = signal<EncodingId | 'auto'>('auto');
  readonly mode = signal<ViewMode>('auto');
  /** Kept for the session (design 010 Annahmen). */
  readonly wrap = signal(false);
  readonly zoom = signal<'fit' | number>('fit');
  readonly query = signal('');
  readonly current = signal(-1);
  private seq = 0;

  private readonly lines = computed(() => {
    const p = this.preview();
    return p?.kind === 'text' ? splitLines(p.text) : [];
  });
  readonly matches = computed(() => findMatches(this.lines(), this.query()));
  readonly matchesCapped = computed(() => this.matches().length >= MAX_MATCHES);
  readonly context = computed<PreviewContext>(() => ({
    compact: false,
    wrap: this.wrap(),
    matches: this.matches(),
    current: this.current(),
    zoom: this.zoom(),
    lines: this.lines(),
  }));
  /** Position among the files of the panel, 1-based. */
  readonly position = computed(() => {
    const entry = this.entry();
    const files = this.files();
    const i = entry ? files.findIndex((f) => f.path === entry.path) : -1;
    return { index: i + 1, count: files.length };
  });
  private readonly files = signal<readonly DirEntry[]>([]);

  /** The cursor of the active panel is on a file. */
  canOpen(): boolean {
    const e = this.ws.panel()?.store.cursorEntry();
    return !!e && isViewableFile(e);
  }

  open(): void {
    const side = this.ws.source();
    const entry = this.ws.panel(side)?.store.cursorEntry();
    if (!entry || !isViewableFile(entry)) {
      return;
    }
    this.side.set(side);
    this.files.set(this.panelFiles(side));
    this.encoding.set('auto');
    this.mode.set('auto');
    this.zoom.set('fit');
    this.current.set(-1);
    this.show(entry);
    this.dialogs.show('viewer');
  }

  close(): void {
    this.seq++;
    this.side.set(null);
    this.entry.set(null);
    this.preview.set(null);
    this.error.set(null);
    this.loading.set(false);
    this.dialogs.close();
  }

  /** ←/→: previous/next file of the panel (folders are skipped); the panel cursor follows. */
  step(delta: 1 | -1): void {
    const side = this.side();
    const entry = this.entry();
    if (side === null || !entry) {
      return;
    }
    const files = this.panelFiles(side);
    this.files.set(files);
    const i = files.findIndex((f) => f.path === entry.path);
    const next = files[i + delta];
    if (i < 0 || !next) {
      return;
    }
    const panel = this.ws.panel(side);
    if (!panel?.controller()?.moveCursorTo(next.path)) {
      panel?.store.setCursor(next.path);
    }
    this.zoom.set('fit');
    this.current.set(-1);
    this.show(next);
  }

  setEncoding(enc: EncodingId | 'auto'): void {
    this.encoding.set(enc);
    void this.load();
  }

  setMode(mode: ViewMode): void {
    this.mode.set(mode);
    void this.load();
  }

  toggleWrap(): void {
    this.wrap.update((w) => !w);
  }

  setQuery(q: string): void {
    this.query.set(q);
    this.current.set(this.matches().length > 0 ? 0 : -1);
  }

  findNext(delta: 1 | -1): void {
    this.current.set(stepMatch(this.current(), this.matches().length, delta));
  }

  zoomStep(delta: 1 | -1, fitScale = 1): void {
    const z = this.zoom();
    const base = z === 'fit' ? fitScale : z;
    const steps = ZOOM_STEPS as readonly number[];
    const next =
      delta === 1
        ? steps.find((s) => s > base + 1e-6)
        : [...steps].reverse().find((s) => s < base - 1e-6);
    this.zoom.set(next ?? base);
  }

  private show(entry: DirEntry): void {
    this.entry.set(entry);
    void this.load();
  }

  private panelFiles(side: Side): readonly DirEntry[] {
    const panel = this.ws.panel(side);
    const rows = panel?.controller()?.displayedEntries() ?? panel?.store.visibleEntries() ?? [];
    return rows.filter(isViewableFile);
  }

  async load(): Promise<void> {
    const entry = this.entry();
    if (!entry) {
      return;
    }
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const p = await this.api.readPreview(entry.path, {
        encoding: this.encoding(),
        mode: this.mode(),
        imageSlot: 'viewer',
      });
      if (seq === this.seq) {
        this.preview.set(p);
        if (this.query()) {
          this.current.set(this.matches().length > 0 ? 0 : -1);
        }
      }
    } catch (err) {
      if (seq === this.seq) {
        const error = toFsError(err);
        this.preview.set(null);
        this.error.set(error);
        // an encrypted archive entry (design 025 E4): ask, then show it again
        if (isPasswordError(error)) {
          this.close();
          this.passwordPrompt.askFor(error, null, () => this.open());
        }
      }
    } finally {
      if (seq === this.seq) {
        this.loading.set(false);
      }
    }
  }
}
