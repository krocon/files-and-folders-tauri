import { inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, DirSize, FsError, isParentRow } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PreviewApi } from '../../core/preview/preview-api';
import { Properties } from '../../core/preview/preview.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';

export type SizeState =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly jobId: string }
  | { readonly state: 'done'; readonly size: DirSize }
  | { readonly state: 'failed'; readonly error: FsError | null };

/**
 * Properties (Alt+Enter, design 010 E5): read only. A folder's size comes from
 * the `dirSize` job (003) on request.
 */
@Injectable({ providedIn: 'root' })
export class PropertiesStore {
  private readonly api = inject(PreviewApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);

  readonly entry = signal<DirEntry | null>(null);
  readonly props = signal<Properties | null>(null);
  readonly error = signal<FsError | null>(null);
  readonly size = signal<SizeState>({ state: 'idle' });
  private seq = 0;

  canOpen(): boolean {
    const e = this.ws.panel()?.store.cursorEntry();
    return !!e && !isParentRow(e);
  }

  async open(): Promise<void> {
    const entry = this.ws.panel()?.store.cursorEntry();
    if (!entry || isParentRow(entry)) {
      return;
    }
    const seq = ++this.seq;
    this.entry.set(entry);
    this.props.set(null);
    this.error.set(null);
    this.size.set({ state: 'idle' });
    this.dialogs.show('properties');
    try {
      const p = await this.api.getProperties(entry.path);
      if (seq === this.seq) {
        this.props.set(p);
      }
    } catch (err) {
      if (seq === this.seq) {
        this.error.set(toFsError(err));
      }
    }
  }

  async calcSize(): Promise<void> {
    const p = this.props();
    if (!p || p.kind !== 'directory' || this.size().state === 'running') {
      return;
    }
    const seq = this.seq;
    let id: string;
    try {
      id = await this.jobs.start({ kind: 'dirSize', path: p.path });
    } catch (err) {
      this.size.set({ state: 'failed', error: toFsError(err) });
      return;
    }
    this.size.set({ state: 'running', jobId: id });
    const job = await this.jobs.whenFinished(id);
    if (seq !== this.seq) {
      return;
    }
    const size = job.summary?.dirSize;
    this.size.set(
      job.state === 'done' && size
        ? { state: 'done', size }
        : job.state === 'cancelled'
          ? { state: 'idle' }
          : { state: 'failed', error: job.summary?.error ?? null },
    );
  }

  cancelSize(): void {
    const s = this.size();
    if (s.state === 'running') {
      void this.jobs.cancel(s.jobId);
    }
  }

  close(): void {
    this.release();
    this.dialogs.close();
  }

  /** Forgets the entry but leaves the dialog slot to the next dialog (Change…, design 024). */
  release(): void {
    this.cancelSize();
    this.seq++;
    this.entry.set(null);
    this.props.set(null);
  }
}
