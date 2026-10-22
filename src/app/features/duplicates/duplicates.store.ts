import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DuplicatesApi, MAX_THUMB_PATHS, THUMB_PX } from '../../core/duplicates/duplicates-api';
import { errorText } from '../../core/fs/fs-error';
import { DirEntry, isNavigableDir } from '../../core/fs/fs.models';
import { DedupeAction, JobInfo } from '../../core/jobs/jobs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { DupMode, SearchHit } from '../../core/search/search.models';
import { Side } from '../../core/session/session.models';
import { formatSize } from '../../shared/format';
import { ConfirmService } from '../../shared/dialog/confirm.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { jobTitle } from '../jobs/job-format';
import { SearchStore } from '../search/search.store';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import {
  DEFAULT_DUP_FORM,
  DupField,
  DuplicatesForm,
  formToDuplicateCriteria,
} from './duplicates-form';
import {
  Chosen,
  defaultSetId,
  familyOf,
  lastSetId,
  NOTHING_CHOSEN,
  parseSetId,
  SetId,
  setOf,
  toFile,
  UserSet,
  userSets,
  withUserSet,
} from './duplicates-presets';
import {
  BUILT_IN_SETS,
  BuiltInSet,
  decide,
  DecideContext,
  DedupePlan,
  dedupePlan,
  groupOrder,
  keepOnly,
  RowDecision,
  RuleSet,
  validateRuleSet,
} from './duplicates-rules';
import { DUP_TEXTS } from './duplicates-texts';

export interface DuplicatesRequest {
  readonly side: Side;
  /** The panel's folder (or the folders of the duplicate tab it was opened from). */
  readonly folder: readonly string[];
  readonly marked: readonly string[];
}

/** What the rules decided for one result (design 042 E2). */
export interface Decided {
  readonly id: SetId;
  readonly decisions: ReadonlyMap<string, RowDecision>;
  readonly undecided: readonly number[];
  /** The marks the rules set – other marks now are the user's. */
  readonly marks: ReadonlySet<string>;
  /** The rules (for the reason column). */
  readonly rules: RuleSet;
}

/** The delete confirmation (design 042 E5). */
export interface DedupeRequest {
  readonly side: Side;
  readonly key: string;
  readonly mode: DupMode;
  readonly plan: DedupePlan;
  readonly undecided: number;
  readonly action: DedupeAction;
  /** Folder of the other side (move), null if it shows none. */
  readonly target: string | null;
  /** First page of groups shown (page size {@link DEDUPE_PAGE}). */
  readonly page: number;
  /** Permanent: the button asks a second time. */
  readonly confirmStep: boolean;
  /** Refused as a root/home/system path: a second "yes" sends `allowDangerous`. */
  readonly dangerous: boolean;
  readonly busy: boolean;
  readonly error: string | null;
}

/** Rule editor (design 042 E2). */
export interface RulesDraft {
  readonly side: Side;
  readonly set: RuleSet;
  readonly name: string;
  /** The set it started from. */
  readonly from: SetId;
}

export const DEDUPE_PAGE = 8;
const IMAGE_NAME = /\.(jpe?g|jpe|jfif|png|gif|webp|bmp|tiff?|cbz|cbr|cb7|cbt)$/i;

/** The search kind of a duplicate result (exact if unknown). */
function modeOf(c: { mode?: DupMode } | null | undefined): DupMode {
  return c?.mode ?? 'exact';
}

/**
 * Duplicate search (OPEN_FIND_DUPLICATES_DLG, design 016 E6 / 042): the dialog, the start
 * (a `duplicates` job shown in a result tab by the `SearchStore`), the rule engine that
 * marks the copies, "keep this one", the group view's data and the delete confirmation
 * (job `dedupe`).
 */
@Injectable({ providedIn: 'root' })
export class DuplicatesStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly search = inject(SearchStore);
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(DuplicatesApi);
  private readonly jobs = inject(JobsStore);
  private readonly confirm = inject(ConfirmService);

  readonly request = signal<DuplicatesRequest | null>(null);
  readonly form = signal<DuplicatesForm>(DEFAULT_DUP_FORM);
  readonly where = signal<'folder' | 'marked'>('folder');
  readonly error = signal<{ field: DupField | null; message: string } | null>(null);
  readonly busy = signal(false);

  // ---- rule sets (design 042 E2)
  readonly userSets = signal<readonly UserSet[]>([]);
  /** The set chosen last for files and for pictures (null: never – the default applies). */
  readonly chosenSets = signal<Chosen>(NOTHING_CHOSEN);
  readonly rulesWarning = signal<string | null>(null);
  private loading: Promise<void> | null = null;
  /** Per result key: what the rules decided. */
  readonly decided = signal<ReadonlyMap<string, Decided>>(new Map());
  /** Per result key: the problem of the set applied last (invalid rule …). */
  readonly ruleError = signal<ReadonlyMap<string, string>>(new Map());
  /** Searches started from the dialog: the set to apply once they end. */
  private readonly pending = new Map<string, SetId>();
  private readonly wasRunning = new Set<string>();
  private applySeq = 0;

  // ---- dialogs and the group view
  readonly dedupe = signal<DedupeRequest | null>(null);
  readonly rules = signal<RulesDraft | null>(null);
  /** Thumbnail URLs by path (null: none can be made). */
  readonly thumbs = signal<ReadonlyMap<string, string | null>>(new Map());
  private readonly thumbWanted = new Set<string>();
  /** Paths waiting for a thumbnail – one batch at a time (review 042 #4: memory). */
  private thumbQueue: string[] = [];
  private thumbBusy = false;
  /** Paths whose thumbnail was fetched again once (a token Rust dropped). */
  private readonly thumbRetried = new Set<string>();

  constructor() {
    // a duplicate search that ended: apply the chosen set (Marc, 042 §8.2); a search run
    // again re-applies the set of its result
    effect(() => {
      const results = this.search.results();
      const shown = (['left', 'right'] as const).map((s) => ({
        side: s,
        key: this.ws.panel(s)?.store.searchKey() ?? null,
      }));
      untracked(() => {
        for (const r of results.values()) {
          if (r.kind !== 'duplicates') {
            continue;
          }
          if (r.running) {
            this.wasRunning.add(r.key);
            continue;
          }
          const ended = this.wasRunning.delete(r.key);
          const id = this.pending.get(r.key) ?? (ended ? this.decided().get(r.key)?.id : undefined);
          if (id === undefined) {
            continue;
          }
          if (r.cancelled || r.error || r.duplicates?.compare === 'size') {
            this.pending.delete(r.key);
            continue;
          }
          const side = shown.find((s) => s.key === r.key)?.side;
          if (side) {
            this.pending.delete(r.key);
            if (id !== 'none') {
              void this.apply(side, id);
            }
          } else if (ended) {
            this.pending.set(r.key, id); // applied once a tab shows it
          }
        }
      });
    });
  }

  // ---------------------------------------------------------------- dialog "Find duplicates"

  /**
   * The result (duplicates or search hits) shown on the active side, or null –
   * its roots are where a duplicate search from there looks.
   */
  private activeResult(): { key: string; roots: readonly string[] } | null {
    const side = this.ws.activeSide();
    const key = this.ws.activeTab(side).search?.key;
    const r = key ? this.search.result(key) : undefined;
    return r && r.criteria.roots.length > 0 ? { key: r.key, roots: r.criteria.roots } : null;
  }

  /** A real folder (not inside an archive) or a result tab is shown on the active side. */
  canOpen(): boolean {
    const store = this.ws.panel(this.ws.activeSide())?.store;
    return (store?.path() != null && store.archive() === null) || this.activeResult() !== null;
  }

  open(): void {
    const side = this.ws.activeSide();
    const store = this.ws.panel(side)?.store;
    const dup = this.activeResult();
    let folder: readonly string[];
    if (dup) {
      folder = dup.roots;
    } else {
      const path = store?.path() ?? null;
      if (path === null || store?.archive()) {
        return;
      }
      folder = [path];
    }
    const marked = dup
      ? []
      : (store?.markedEntries() ?? [])
          .filter((e) => isNavigableDir(e) && !e.lossyName)
          .map((e) => e.path);
    this.where.set(marked.length > 0 ? 'marked' : 'folder');
    this.error.set(null);
    this.request.set({ side, folder, marked });
    void this.ensureRules();
    this.dialogs.show('duplicates');
  }

  update(patch: Partial<DuplicatesForm>): void {
    this.form.update((f) => ({ ...f, ...patch }));
    this.error.set(null);
  }

  /** The set chosen last for `mode`'s family (null: never). */
  chosen(mode: DupMode = 'exact'): SetId | null {
    return this.chosenSets()[familyOf(mode)];
  }

  /** The set the dialog offers for `mode` (the one chosen last, else the default). */
  setFor(mode: DupMode): SetId {
    return this.chosen(mode) ?? defaultSetId(mode !== 'exact');
  }

  async run(): Promise<void> {
    const req = this.request();
    if (!req || this.busy()) {
      return;
    }
    const roots = this.where() === 'marked' && req.marked.length > 0 ? req.marked : req.folder;
    if (roots.length === 0) {
      this.error.set({ field: null, message: DUP_TEXTS.noFolder });
      return;
    }
    const built = formToDuplicateCriteria(this.form(), roots);
    if ('error' in built) {
      this.error.set(built.error);
      return;
    }
    const setId = this.setFor(this.form().mode);
    this.busy.set(true);
    try {
      const error = await this.search.findDuplicates(built.criteria, req.side);
      if (error) {
        this.error.set({ field: null, message: errorText(error) });
        return;
      }
      const key = this.ws.activeTab(req.side).search?.key;
      if (key && built.criteria.compare !== 'size') {
        this.pending.set(key, setId);
      }
      this.close();
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.request()) {
      this.request.set(null);
      this.dialogs.close();
    }
  }

  // ---------------------------------------------------------------- rule sets

  /** Loads the user's sets once. */
  ensureRules(): Promise<void> {
    this.loading ??= this.api
      .loadRules()
      .then((loaded) => {
        this.userSets.set(userSets(loaded.presets));
        this.chosenSets.set({
          files: lastSetId(loaded.presets, 'files'),
          pictures: lastSetId(loaded.presets, 'pictures'),
        });
        this.rulesWarning.set(loaded.warning);
      })
      .catch((e: unknown) => {
        this.rulesWarning.set(errorText(e as never));
      });
    return this.loading;
  }

  /** Remembers `id` as the chosen set of `mode`'s family (saved with the user's sets). */
  choose(id: SetId, mode: DupMode = 'exact'): void {
    this.chosenSets.update((c) => ({ ...c, [familyOf(mode)]: id }));
    this.save();
  }

  private save(): void {
    void this.api
      .saveRules(toFile(this.userSets(), this.chosenSets()))
      .catch((e: unknown) => this.rulesWarning.set(errorText(e as never)));
  }

  /** Label of a set for selects and the header. */
  setLabel(id: SetId): string {
    if (id === 'none') {
      return DUP_TEXTS.noRules;
    }
    return id.startsWith('b:') ? (DUP_TEXTS.builtIn[id.slice(2)] ?? id) : id.slice(2);
  }

  /** Every set to choose from (built-in first). */
  setIds(): SetId[] {
    return [
      ...(Object.keys(BUILT_IN_SETS) as BuiltInSet[]).map((b) => `b:${b}` as SetId),
      ...this.userSets().map((u) => `u:${u.name}` as SetId),
    ];
  }

  // ---------------------------------------------------------------- the active duplicate tab

  /** Key and side of the duplicate result shown on `side` (exact or similar, not size-only). */
  private tabOn(
    side: Side = this.ws.activeSide(),
  ): { key: string; store: NonNullable<ReturnType<WorkspaceStore['panel']>>['store'] } | null {
    const store = this.ws.panel(side)?.store;
    const key = store?.searchKey() ?? null;
    if (
      !store ||
      key === null ||
      store.searchKind() !== 'duplicates' ||
      this.search.sizeOnly(key)
    ) {
      return null;
    }
    return { key, store };
  }

  /** The active panel shows duplicates whose contents (or looks) were compared. */
  canMark(): boolean {
    const t = this.tabOn();
    return t !== null && this.search.result(t.key)?.running === false;
  }

  /** The duplicates shown on `side` were compared by size only. */
  sizeOnly(side: Side = this.ws.activeSide()): boolean {
    return this.search.sizeOnly(this.ws.panel(side)?.store.searchKey());
  }

  /** Result `key` compared sizes only (no decisions, no deleting). */
  sizeOnlyKey(key: string | null): boolean {
    return this.search.sizeOnly(key);
  }

  /** Mode of the duplicate result shown on `side`. */
  modeOn(side: Side): DupMode {
    const key = this.ws.panel(side)?.store.searchKey();
    return modeOf(key ? this.search.result(key)?.duplicates : null);
  }

  private rowsOf(key: string): readonly SearchHit[] {
    return this.search.result(key)?.hits ?? [];
  }

  /** The set applied to the result on `side`, else the one to choose. */
  setOn(side: Side): SetId {
    const t = this.tabOn(side);
    const applied = t ? this.decided().get(t.key)?.id : undefined;
    if (applied && applied !== 'none') {
      return applied;
    }
    const chosen = this.chosen(this.modeOn(side));
    return chosen && chosen !== 'none' ? chosen : defaultSetId(this.modeOn(side) !== 'exact');
  }

  /** "Keep newest/oldest/first" (016 E6): the built-in set of that name. */
  markAllBut(rule: 'newest' | 'oldest' | 'first'): void {
    const id: SetId = rule === 'first' ? 'b:shortestPath' : `b:${rule}`;
    void this.apply(this.ws.activeSide(), id);
  }

  /** Header button / DUP_APPLY_RULES: asks first if the user changed marks by hand. */
  async applyChosen(
    side: Side = this.ws.activeSide(),
    id: SetId = this.setOn(side),
  ): Promise<void> {
    const t = this.tabOn(side);
    if (!t) {
      return;
    }
    const before = this.decided().get(t.key)?.marks ?? new Set<string>();
    const now = t.store.marked();
    const manual =
      now.size > 0 && (now.size !== before.size || [...now].some((p) => !before.has(p)));
    if (
      manual &&
      !(await this.confirm.ask({
        title: DUP_TEXTS.header,
        message: DUP_TEXTS.replaceManual,
        confirmLabel: DUP_TEXTS.apply,
      }))
    ) {
      return;
    }
    await this.apply(side, id);
  }

  /** Applies set `id` to the result on `side`: replaces the marks. */
  async apply(side: Side, id: SetId): Promise<void> {
    await this.ensureRules();
    const t = this.tabOn(side);
    if (!t) {
      return;
    }
    const set = setOf(id, this.userSets());
    if (id !== this.chosen(this.modeOn(side))) {
      this.choose(id, this.modeOn(side));
    }
    const seq = ++this.applySeq;
    const errors = new Map(this.ruleError());
    errors.delete(t.key);
    if (!set) {
      this.ruleError.set(errors);
      return;
    }
    const invalid = validateRuleSet(set);
    if (invalid) {
      errors.set(t.key, DUP_TEXTS.ruleError(invalid.reason, invalid.rule + 1));
      this.ruleError.set(errors);
      return;
    }
    const rows = this.rowsOf(t.key);
    let ctx: DecideContext;
    try {
      ctx = await this.contextFor(set, rows);
    } catch (e) {
      errors.set(t.key, errorText(e as never));
      this.ruleError.set(errors);
      return;
    }
    if (seq !== this.applySeq || this.tabOn(side)?.key !== t.key) {
      return; // another apply or another tab meanwhile
    }
    const res = decide(rows, set, ctx);
    t.store.clearMarks();
    t.store.setMarked(res.marks, true);
    const next = new Map(this.decided());
    next.set(t.key, {
      id,
      decisions: res.decisions,
      undecided: res.undecided,
      marks: new Set(res.marks),
      rules: set,
    });
    this.decided.set(next);
    this.ruleError.set(errors);
  }

  /** `inFolder` rules ask Rust which paths lie in their folders (paths are opaque here). */
  private async contextFor(set: RuleSet, rows: readonly SearchHit[]): Promise<DecideContext> {
    const folders: string[] = [];
    const column = new Map<number, number>();
    set.rules.forEach((r, i) => {
      if (r.kind === 'inFolder' && r.folder) {
        let c = folders.indexOf(r.folder);
        if (c < 0) {
          c = folders.push(r.folder) - 1;
        }
        column.set(i, c);
      }
    });
    if (folders.length === 0) {
      return {};
    }
    const paths = rows.map((r) => r.path);
    const answer = await this.api.classifyPaths(paths, folders);
    const byPath = new Map(paths.map((p, i) => [p, answer[i]]));
    return { inFolder: (p, rule) => byPath.get(p)?.[column.get(rule) ?? -1] ?? false };
  }

  /** Short text of a reason (the rule's name, "by you", "has hard links"). */
  reasonLabel(key: string, reason: RowDecision['reason']): string {
    if (reason === null) {
      return '';
    }
    if (reason === 'manual') {
      return DUP_TEXTS.reasonManual;
    }
    if (reason === 'links') {
      return DUP_TEXTS.reasonLinks;
    }
    const rule = this.decided().get(key)?.rules.rules[reason];
    return rule ? (DUP_TEXTS.ruleShort[rule.kind] ?? rule.kind) : '';
  }

  /** What the rules decided for `path` in result `key`. */
  decisionOf(key: string, path: string): RowDecision | undefined {
    return this.decided().get(key)?.decisions.get(path);
  }

  /** Enter / double-click / button: only this file of its group stays. */
  keepThis(side: Side = this.ws.activeSide(), path?: string): boolean {
    const t = this.tabOn(side);
    const at = path ?? this.ws.panel(side)?.controller()?.cursorEntry()?.path;
    if (!t || !at) {
      return false;
    }
    const change = keepOnly(this.rowsOf(t.key), at);
    if (!change) {
      return false;
    }
    t.store.setMarked(change.unmark, false);
    t.store.setMarked(change.mark, true);
    return true;
  }

  /** The panel hands Enter on a duplicate here (design 042 E1). */
  navigator(side: Side): { open(entry: DirEntry): boolean } {
    return { open: (entry) => this.keepThis(side, entry.path) };
  }

  /** Alt+↓ / Alt+↑: the cursor to the first row of the next/previous group (displayed order). */
  moveGroup(delta: 1 | -1, side: Side = this.ws.activeSide()): void {
    const c = this.ws.panel(side)?.controller();
    if (!c || !this.tabOn(side)) {
      return;
    }
    const rows = c.displayedEntries() as readonly SearchHit[];
    const groups = groupOrder(rows);
    const current = (c.cursorEntry() as SearchHit | undefined)?.group;
    const at = current === undefined ? (delta > 0 ? -1 : groups.length) : groups.indexOf(current);
    const target = groups[at + delta];
    if (target === undefined) {
      return;
    }
    const first = rows.find((r) => r.group === target);
    if (first) {
      c.moveCursorTo(first.path);
    }
  }

  canMoveGroup(): boolean {
    return this.tabOn() !== null;
  }

  // ---------------------------------------------------------------- thumbnails

  /** Thumbnail URLs for `paths` (images and comics only); missing ones are fetched. */
  wantThumbs(paths: readonly string[]): void {
    const missing = paths.filter(
      (p) => IMAGE_NAME.test(p) && !this.thumbs().has(p) && !this.thumbWanted.has(p),
    );
    missing.forEach((p) => this.thumbWanted.add(p));
    // the newest wish first: the group or page just shown
    this.thumbQueue = [...missing, ...this.thumbQueue];
    this.pumpThumbs();
  }

  /** An `<img>` failed: Rust dropped the token (bounded store) – fetch once more. */
  thumbFailed(path: string): void {
    if (this.thumbRetried.has(path)) {
      const next = new Map(this.thumbs());
      next.set(path, null);
      this.thumbs.set(next);
      return;
    }
    this.thumbRetried.add(path);
    const next = new Map(this.thumbs());
    next.delete(path);
    this.thumbs.set(next);
    this.wantThumbs([path]);
  }

  private pumpThumbs(): void {
    if (this.thumbBusy || this.thumbQueue.length === 0) {
      return;
    }
    const batch = this.thumbQueue.splice(0, MAX_THUMB_PATHS);
    this.thumbBusy = true;
    const store = (tokens: readonly (string | null)[] | null) => {
      const next = new Map(this.thumbs());
      batch.forEach((p, k) => {
        const t = tokens?.[k];
        next.set(p, t ? this.api.imageUrl(t) : null);
      });
      this.thumbs.set(next);
    };
    void this.api
      .thumbnails(batch, THUMB_PX)
      .then(store, () => store(null))
      .finally(() => {
        batch.forEach((p) => this.thumbWanted.delete(p));
        this.thumbBusy = false;
        this.pumpThumbs();
      });
  }

  // ---------------------------------------------------------------- deleting (design 042 E5)

  /** F8 / Shift+F8 / button in a duplicate tab. */
  openDedupe(action: DedupeAction = 'trash', side: Side = this.ws.activeSide()): boolean {
    const t = this.tabOn(side);
    if (!t) {
      return false;
    }
    const rows = this.rowsOf(t.key);
    const decided = this.decided().get(t.key);
    const plan = dedupePlan(rows, t.store.marked(), decided?.decisions);
    if (plan.files === 0) {
      this.jobs.report(DUP_TEXTS.nothingMarked);
      return true;
    }
    const other = this.ws.panel(otherSide(side))?.store;
    const target =
      other && other.searchKey() === null && other.archive() === null ? other.path() : null;
    this.dedupe.set({
      side,
      key: t.key,
      mode: modeOf(this.search.result(t.key)?.duplicates),
      plan,
      undecided: decided?.undecided.length ?? 0,
      action,
      target,
      page: 0,
      confirmStep: false,
      dangerous: false,
      busy: false,
      error: null,
    });
    this.dialogs.show('dedupe');
    return true;
  }

  updateDedupe(patch: Partial<DedupeRequest>): void {
    this.dedupe.update((r) => (r ? { ...r, confirmStep: false, error: null, ...patch } : r));
  }

  closeDedupe(): void {
    if (this.dedupe()) {
      this.dedupe.set(null);
      this.dialogs.close();
    }
  }

  /** The confirm button: permanent asks twice; then the job starts. */
  async runDedupe(): Promise<void> {
    const req = this.dedupe();
    if (!req || req.busy) {
      return;
    }
    if (req.action === 'permanent' && !req.confirmStep) {
      this.dedupe.set({ ...req, confirmStep: true });
      return;
    }
    if (req.action === 'move' && !req.target) {
      return;
    }
    this.dedupe.set({ ...req, busy: true, error: null });
    let id: string;
    try {
      id = await this.jobs.start({
        kind: 'dedupe',
        groups: req.plan.groups,
        action: req.action,
        ...(req.action === 'move' && req.target ? { targetDir: req.target } : {}),
        verify:
          req.mode === 'exact'
            ? 'content'
            : req.mode === 'comics'
              ? 'similarComics'
              : 'similarImages',
        ...(req.mode === 'exact'
          ? {}
          : { threshold: this.search.result(req.key)?.duplicates?.threshold ?? null }),
        allowDangerous: req.dangerous,
      });
    } catch (e) {
      const err = e as { code?: string };
      this.dedupe.set({
        ...req,
        busy: false,
        confirmStep: false,
        dangerous: err.code === 'dangerous_path',
        error: errorText(e as never),
      });
      return;
    }
    this.closeDedupe();
    const removed = req.plan.groups.flatMap((g) => g.remove.map((r) => r.path));
    void this.jobs.whenFinished(id).then((job) => this.afterDedupe(job, req, removed));
  }

  /** Removed copies leave the result; failures are reported (the job list has the details). */
  private afterDedupe(job: JobInfo, req: DedupeRequest, removed: readonly string[]): void {
    const s = job.summary;
    const ran = job.state === 'done' || job.state === 'doneWithErrors';
    // only when every failure is listed: otherwise nothing is certain – "Search again" helps
    if (ran && s && s.itemsFailed === s.errors.length) {
      const failed = new Set(s.errors.map((e) => e.path));
      const done = removed.filter((p) => !failed.has(p));
      this.search.removePaths(req.key, done);
      this.ws.panel(req.side)?.store.setMarked(done, false);
    }
    if (job.state === 'failed' && s?.error) {
      this.jobs.report(`${jobTitle(job)}: ${errorText(s.error)}`);
    } else if (job.state === 'doneWithErrors' && s) {
      this.jobs.report(DUP_TEXTS.dedupeFinished(jobTitle(job), s.itemsFailed));
    }
  }

  /** Bytes for the header and the dialog. */
  bytesText(bytes: number): string {
    return formatSize(bytes);
  }

  // ---------------------------------------------------------------- rule editor

  openRules(side: Side = this.ws.activeSide()): void {
    void this.ensureRules().then(() => {
      const from = this.setOn(side);
      const set = setOf(from, this.userSets()) ?? BUILT_IN_SETS.copyNamesThenOldest;
      this.rules.set({
        side,
        set,
        name: from.startsWith('u:') ? from.slice(2) : '',
        from,
      });
      this.dialogs.show('duplicate-rules');
    });
  }

  updateRules(set: RuleSet): void {
    this.rules.update((d) => (d ? { ...d, set } : d));
  }

  setRulesName(name: string): void {
    this.rules.update((d) => (d ? { ...d, name } : d));
  }

  /** Saves the draft as user set `name` and chooses it. */
  saveRules(): SetId | null {
    const d = this.rules();
    const name = d?.name.trim() ?? '';
    if (!d || name === '' || validateRuleSet(d.set)) {
      return null;
    }
    this.userSets.set(withUserSet(this.userSets(), name, d.set));
    const id = `u:${name}` as SetId;
    this.chosenSets.update((c) => ({ ...c, [familyOf(this.modeOn(d.side))]: id }));
    this.save();
    this.rules.set({ ...d, from: id });
    return id;
  }

  deleteUserSet(name: string): void {
    this.userSets.set(this.userSets().filter((u) => u.name !== name));
    const gone = (id: SetId | null) => (id === `u:${name}` ? null : id);
    this.chosenSets.update((c) => ({ files: gone(c.files), pictures: gone(c.pictures) }));
    this.save();
    this.rules.update((d) => (d && d.from === `u:${name}` ? { ...d, from: 'none', name: '' } : d));
  }

  /** "Apply" in the editor: the draft as it is (saved first when it has a name). */
  async applyRules(): Promise<void> {
    const d = this.rules();
    if (!d || validateRuleSet(d.set)) {
      return;
    }
    const id = d.name.trim() !== '' ? this.saveRules() : null;
    this.closeRules();
    if (id) {
      await this.applyChosen(d.side, id);
    } else {
      await this.applyDraft(d.side, d.set);
    }
  }

  /** A draft without a name: applied once, not stored. */
  private async applyDraft(side: Side, set: RuleSet): Promise<void> {
    const t = this.tabOn(side);
    if (!t) {
      return;
    }
    const rows = this.rowsOf(t.key);
    const res = decide(rows, set, await this.contextFor(set, rows));
    t.store.clearMarks();
    t.store.setMarked(res.marks, true);
    const next = new Map(this.decided());
    next.set(t.key, {
      id: 'none',
      decisions: res.decisions,
      undecided: res.undecided,
      marks: new Set(res.marks),
      rules: set,
    });
    this.decided.set(next);
  }

  /** Live preview of the editor: groups decided/undecided on the current result. */
  previewRules(set: RuleSet, side: Side): { decided: number; undecided: number } | null {
    const t = this.tabOn(side);
    if (!t || validateRuleSet(set) || set.rules.some((r) => r.kind === 'inFolder')) {
      return null;
    }
    const rows = this.rowsOf(t.key);
    const res = decide(rows, set);
    const groups = new Set(rows.map((r) => r.group)).size;
    return { decided: groups - res.undecided.length, undecided: res.undecided.length };
  }

  closeRules(): void {
    if (this.rules()) {
      this.rules.set(null);
      this.dialogs.close();
    }
  }

  /** Parses a set id from a `<select>`. */
  parseSet(value: string): SetId | null {
    return parseSetId(value);
  }
}
