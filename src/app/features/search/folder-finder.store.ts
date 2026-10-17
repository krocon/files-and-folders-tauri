import { computed, inject, Injectable, signal } from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { MAX_HITS, SearchHit } from '../../core/search/search.models';
import { Side } from '../../core/session/session.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { FolderFilter, moveActive } from './folder-finder-logic';
import { SEARCH_TEXTS } from './search-texts';

export const DEFAULT_DEPTH = 5;
/** Slider maximum; the value above it means "no limit". */
export const MAX_SLIDER_DEPTH = 10;
const PUBLISH_MS = 200;

/**
 * Folder finder (OPEN_FOLDER_FINDER_DLG, Alt+F10, design 009 E6; legacy "Change
 * Dir"): a `search` job for the folders below the current one, filtered live
 * and fuzzy; Enter changes the panel there; closing cancels the job.
 */
@Injectable({ providedIn: 'root' })
export class FolderFinderStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly jobs = inject(JobsStore);
  private readonly dialogs = inject(DialogService);
  private jobId: string | null = null;
  private unsubscribe: () => void = () => undefined;
  /** Hits of the current job (append-only; a new array per job). */
  private buffer: SearchHit[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Every start gets a number; an older start that resolves late gives up (review 009 #9). */
  private startSeq = 0;
  /** Hits the last publish showed. */
  private published = 0;
  /** Filters only the new hits while the filter text stays (review 009 #8). */
  private readonly filterer = new FolderFilter();

  readonly request = signal<{ side: Side; root: string; hidden: boolean } | null>(null);
  readonly depth = signal(DEFAULT_DEPTH);
  readonly filter = signal('');
  /** The found folders: the job's buffer itself (no copy per publish), hence `equal: false`. */
  readonly folders = signal<readonly SearchHit[]>([], { equal: () => false });
  readonly running = signal(false);
  readonly error = signal<FsError | null>(null);
  readonly unreadable = signal(0);
  readonly active = signal(0);
  /** Said once by the dialog's live region when the search ends (review 009 #11). */
  readonly announcement = signal('');
  readonly shown = computed(() => this.filterer.apply(this.folders(), this.filter()));
  readonly activeFolder = computed<SearchHit | null>(() => this.shown()[this.active()] ?? null);

  hasFolder(): boolean {
    return (this.ws.panel()?.store.path() ?? null) !== null;
  }

  open(): void {
    const side = this.ws.activeSide();
    const store = this.ws.panel(side)?.store;
    const root = store?.path() ?? null;
    if (!store || root === null) {
      return;
    }
    this.filter.set('');
    this.request.set({ side, root, hidden: store.hiddenVisible() });
    this.dialogs.show('folder-finder');
    void this.start();
  }

  setFilter(text: string): void {
    this.filter.set(text);
    this.active.set(0);
  }

  setDepth(depth: number): void {
    this.depth.set(Math.max(1, Math.min(MAX_SLIDER_DEPTH + 1, Math.round(depth))));
    void this.start();
  }

  /** ↑ ↓ PgUp PgDn (Home/End stay with the input). Returns true if the key moved the selection. */
  key(key: string): boolean {
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(key)) {
      return false;
    }
    this.active.set(moveActive(this.active(), key, this.shown().length));
    return true;
  }

  select(index: number): void {
    this.active.set(index);
  }

  /** Enter: the panel opens the chosen folder. */
  choose(index = this.active()): void {
    const req = this.request();
    const folder = this.shown()[index];
    if (!req || !folder) {
      return;
    }
    this.close();
    this.ws.setActive(req.side);
    this.ws.requestNavigate(req.side, folder.path);
    this.ws.requestFocus(req.side);
  }

  close(): void {
    this.stop();
    if (this.request()) {
      this.request.set(null);
      this.folders.set([]);
      this.dialogs.close();
    }
  }

  private async start(): Promise<void> {
    const req = this.request();
    if (!req) {
      return;
    }
    const seq = ++this.startSeq;
    this.stop();
    this.buffer = [];
    this.published = 0;
    this.folders.set(this.buffer);
    this.unreadable.set(0);
    this.error.set(null);
    this.announcement.set('');
    this.active.set(0);
    this.running.set(true);
    const depth = this.depth();
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'search',
        criteria: {
          roots: [req.root],
          name: '',
          nameMode: 'glob',
          caseSensitive: false,
          wholeName: true,
          kinds: { files: false, dirs: true, links: false },
          includeHidden: req.hidden,
          followLinks: false,
          maxDepth: depth > MAX_SLIDER_DEPTH ? null : depth,
          excludes: ['.git', 'node_modules'],
          maxHits: MAX_HITS,
        },
      });
    } catch (err) {
      if (seq === this.startSeq) {
        this.running.set(false);
        this.error.set(toFsError(err));
      }
      return;
    }
    if (seq !== this.startSeq || this.request() !== req) {
      void this.jobs.cancel(id); // closed or restarted meanwhile
      return;
    }
    this.jobId = id;
    const buffer = this.buffer;
    // hits that arrived before the id (buffered by JobsStore) come at once
    this.unsubscribe = this.jobs.onSearchHits(id, (hits, stats) => {
      if (this.jobId !== id) {
        return;
      }
      buffer.push(...hits);
      this.unreadable.set(stats.unreadable);
      this.schedule();
    });
    const job = await this.jobs.whenFinished(id);
    if (this.jobId !== id || seq !== this.startSeq) {
      return;
    }
    this.publish();
    this.running.set(false);
    this.unreadable.set(job.summary?.search?.unreadable ?? 0);
    if (job.state === 'failed') {
      this.error.set(job.summary?.error ?? null);
    }
    // the count is announced once, at the end (the visible counter is no live region)
    const n = this.folders().length;
    this.announcement.set(SEARCH_TEXTS.finderCount(n, n));
    this.unsubscribe();
    this.unsubscribe = () => undefined;
    this.jobId = null;
  }

  private schedule(): void {
    if (this.timer !== null) {
      return;
    }
    if (this.published === 0) {
      this.publish(); // the first folders at once
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish();
    }, PUBLISH_MS);
  }

  /** Publishes the grown buffer (the same array: the filter only looks at the new hits). */
  private publish(): void {
    if (this.buffer.length !== this.published) {
      this.published = this.buffer.length;
      this.folders.set(this.buffer);
    }
  }

  private stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.unsubscribe();
    this.unsubscribe = () => undefined;
    if (this.jobId !== null) {
      void this.jobs.cancel(this.jobId);
      this.jobId = null;
    }
    this.running.set(false);
  }
}
