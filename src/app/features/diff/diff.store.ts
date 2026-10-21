import { computed, inject, Injectable, signal } from '@angular/core';
import { DiffApi } from '../../core/diff/diff-api';
import { DiffResult, DiffRowKind } from '../../core/diff/diff.models';
import { errorText, toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError } from '../../core/fs/fs.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { OsStore } from '../osintegration/os.store';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import { cellText, changeStarts, ComparePanel, pickFiles } from './compare-files-logic';
import { DIFF_TEXTS } from './diff-texts';

/** Equal lines kept around a difference unless "whole file" is on. */
export const CONTEXT_LINES = 3;

export interface DiffGridRow {
  readonly kind: DiffRowKind;
  readonly ln: string;
  readonly lt: string;
  readonly rn: string;
  readonly rt: string;
}

export interface DiffViewOptions {
  readonly ignoreWhitespace: boolean;
  readonly ignoreCase: boolean;
  readonly wholeFile: boolean;
}

function err(message: string): FsError {
  return { code: 'unknown', message, path: null };
}

/**
 * Compare files (COMPARE_FILES, design 037): picks the two files, asks Rust for the
 * side-by-side rows (stale answers dropped), steps through the differences and hands
 * the pair to the external tool `diff` if configured.
 */
@Injectable({ providedIn: 'root' })
export class DiffStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly api = inject(DiffApi);
  private readonly dialogs = inject(DialogService);
  private readonly os = inject(OsStore);
  private seq = 0;

  readonly pair = signal<{ readonly left: DirEntry; readonly right: DirEntry } | null>(null);
  readonly options = signal<DiffViewOptions>({
    ignoreWhitespace: false,
    ignoreCase: false,
    wholeFile: false,
  });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<DiffResult | null>(null);
  /** Index into `starts` of the difference shown, -1 = none yet. */
  readonly current = signal(-1);

  readonly gridRows = computed<readonly DiffGridRow[]>(() => {
    const r = this.result();
    if (r?.kind !== 'text') {
      return [];
    }
    return r.rows.map((row) => ({
      kind: row.kind,
      ln: row.left ? String(row.left[0]) : '',
      lt:
        row.kind === 'skip' ? DIFF_TEXTS.skipped(row.skipped ?? 0) : cellText(row.left?.[1] ?? ''),
      rn: row.right ? String(row.right[0]) : '',
      rt: row.kind === 'skip' ? '' : cellText(row.right?.[1] ?? ''),
    }));
  });
  readonly starts = computed(() => {
    const r = this.result();
    return r?.kind === 'text' ? changeStarts(r.rows) : [];
  });
  /** Grid row of the current difference (scrolled into view), -1 = none. */
  readonly activeRow = computed(() => this.starts()[this.current()] ?? -1);
  /** The external compare tool, if configured. */
  readonly externalTool = computed(() => this.os.tools().find((t) => t.id === 'diff') ?? null);

  /** A pair can be compared (for the action's state). */
  canCompare(): boolean {
    return 'left' in this.pick();
  }

  private panelOf(side: 'left' | 'right'): ComparePanel | null {
    const panel = this.ws.panel(side);
    if (!panel) {
      return null;
    }
    return {
      side,
      marked: panel.store.markedEntries(),
      cursor: panel.controller()?.cursorEntry() ?? null,
    };
  }

  private pick() {
    const side = this.ws.activeSide();
    const active = this.panelOf(side);
    if (!active) {
      return { problem: 'notFiles' as const };
    }
    return pickFiles(active, this.panelOf(otherSide(side)));
  }

  open(): void {
    const p = this.pick();
    if (!('left' in p)) {
      const text =
        p.problem === 'twoMarked'
          ? DIFF_TEXTS.needTwo
          : p.problem === 'noOtherFile'
            ? DIFF_TEXTS.noOtherFile
            : p.problem === 'same'
              ? DIFF_TEXTS.same
              : DIFF_TEXTS.notFiles;
      throw err(text);
    }
    this.pair.set(p);
    this.result.set(null);
    this.current.set(-1);
    this.dialogs.show('diff');
    void this.load();
  }

  setOptions(patch: Partial<DiffViewOptions>): void {
    this.options.set({ ...this.options(), ...patch });
    void this.load();
  }

  async load(): Promise<void> {
    const pair = this.pair();
    if (!pair) {
      return;
    }
    const seq = ++this.seq;
    const o = this.options();
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.api.diff(pair.left.path, pair.right.path, {
        ignoreWhitespace: o.ignoreWhitespace,
        ignoreCase: o.ignoreCase,
        context: o.wholeFile ? null : CONTEXT_LINES,
      });
      if (seq !== this.seq) {
        return;
      }
      this.result.set(r);
      this.current.set(r.kind === 'text' && changeStarts(r.rows).length > 0 ? 0 : -1);
    } catch (e) {
      if (seq === this.seq) {
        this.result.set(null);
        this.error.set(errorText(toFsError(e)));
      }
    } finally {
      if (seq === this.seq) {
        this.loading.set(false);
      }
    }
  }

  next(): void {
    const n = this.starts().length;
    if (n > 0) {
      this.current.set(Math.min(n - 1, this.current() + 1));
    }
  }

  previous(): void {
    if (this.starts().length > 0) {
      this.current.set(Math.max(0, this.current() - 1));
    }
  }

  async openExternal(): Promise<void> {
    const pair = this.pair();
    const tool = this.externalTool();
    if (!pair || !tool) {
      return;
    }
    try {
      await this.os.runToolWith(tool.id, [pair.left.path, pair.right.path]);
      this.close();
    } catch (e) {
      this.error.set(errorText(toFsError(e)));
    }
  }

  close(): void {
    this.seq++;
    this.pair.set(null);
    this.result.set(null);
    this.dialogs.close();
  }
}
