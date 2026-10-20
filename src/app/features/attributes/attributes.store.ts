import { computed, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { toFsError } from '../../core/fs/fs-error';
import { DirEntry, FsError, isParentRow } from '../../core/fs/fs.models';
import { JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { PreviewApi } from '../../core/preview/preview-api';
import { Properties } from '../../core/preview/preview.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { selectionForAction } from '../ops/ops-logic';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  AttrForm,
  buildChange,
  countChanges,
  fieldsFor,
  initialForm,
  invalidTimes,
} from './attributes-logic';
import { AT_TEXTS } from './attributes-texts';

/** Start values are read for at most this many entries (design 024 E9). */
export const MAX_PROBED = 100;

export interface AttrRequest {
  /** The selected entries (links included – Rust reports them). */
  readonly entries: readonly DirEntry[];
}

/**
 * Change attributes (OPEN_CHANGE_ATTRIBUTES_DLG, design 024): selection → dialog
 * with tri-state fields → one `attributes` job. The panels reload through the
 * job's `dirsChanged` events.
 */
@Injectable({ providedIn: 'root' })
export class AttributesStore {
  private readonly preview = inject(PreviewApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private readonly actions = inject(ActionService);

  readonly request = signal<AttrRequest | null>(null);
  readonly form = signal<AttrForm | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly runError = signal<FsError | null>(null);
  private seq = 0;

  /** Fields of the OS the app runs on (the keymap's platform, settable in tests). */
  readonly fields = computed(() => fieldsFor(this.actions.platform()));
  readonly change = computed(() => {
    const f = this.form();
    return f ? buildChange(f, this.fields()) : {};
  });
  readonly changeCount = computed(() => countChanges(this.change()));
  readonly links = computed(
    () => this.request()?.entries.filter((e) => e.kind === 'symlink').length ?? 0,
  );
  readonly invalidTimes = computed(() => {
    const f = this.form();
    return f ? invalidTimes(f, this.fields()) : [];
  });
  readonly canRun = computed(
    () =>
      this.request() !== null &&
      !this.loading() &&
      !this.busy() &&
      this.changeCount() > 0 &&
      this.invalidTimes().length === 0,
  );

  canOpen(): boolean {
    return selectionForAction(this.ws.panel()?.store).length > 0;
  }

  open(): void {
    void this.openFor(selectionForAction(this.ws.panel()?.store));
  }

  /** Opens the dialog for these entries (also from the properties dialog). */
  async openFor(entries: readonly DirEntry[]): Promise<void> {
    const list = entries.filter((e) => !isParentRow(e));
    if (list.length === 0) {
      return;
    }
    const seq = ++this.seq;
    const now = Date.now();
    this.request.set({ entries: list });
    this.form.set(initialForm(null, this.fields(), now));
    this.runError.set(null);
    this.busy.set(false);
    this.dialogs.show('attributes');
    const real = list.filter((e) => e.kind !== 'symlink');
    if (real.length === 0 || real.length > MAX_PROBED) {
      return; // links only, or too many: everything starts as "unchanged"
    }
    this.loading.set(true);
    let props: Properties[] | null;
    try {
      props = await Promise.all(real.map((e) => this.preview.getProperties(e.path)));
    } catch {
      props = null; // one entry vanished …: start as "unchanged"
    }
    if (seq !== this.seq) {
      return;
    }
    this.loading.set(false);
    // the user may not have touched anything yet – replace only an untouched form
    const f = this.form();
    if (props && f && untouched(f)) {
      this.form.set(initialForm(props, this.fields(), now));
    }
  }

  update(fn: (f: AttrForm) => AttrForm): void {
    const f = this.form();
    if (f) {
      this.form.set(fn(f));
      this.runError.set(null);
    }
  }

  async run(): Promise<void> {
    const req = this.request();
    const form = this.form();
    if (!req || !form || !this.canRun()) {
      return;
    }
    this.busy.set(true);
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'attributes',
        paths: req.entries.map((e) => e.path),
        change: this.change(),
        recursive: form.recursive,
        applyTo: form.recursive ? form.applyTo : 'all',
      });
    } catch (e) {
      this.runError.set(toFsError(e));
      this.busy.set(false);
      return;
    }
    this.close();
    void this.jobs.whenFinished(id).then((job) => this.afterJob(job));
  }

  private afterJob(job: JobInfo): void {
    const s = job.summary;
    if (job.state === 'failed') {
      this.jobs.report(AT_TEXTS.failed(s?.error?.message ?? ''));
    } else if (job.state === 'doneWithErrors' && s) {
      this.jobs.report(AT_TEXTS.withErrors(s.itemsFailed));
    } else if (job.state === 'done' && s) {
      this.jobs.report(AT_TEXTS.done(s.itemsDone, s.itemsSkipped));
    }
  }

  close(): void {
    this.seq++;
    this.request.set(null);
    this.form.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.dialogs.close();
  }
}

function untouched(f: AttrForm): boolean {
  return (
    Object.values(f.bits).every((b) => !b.touched) &&
    Object.values(f.flags).every((b) => !b.touched) &&
    Object.values(f.times).every((t) => !t.enabled) &&
    !f.recursive
  );
}
