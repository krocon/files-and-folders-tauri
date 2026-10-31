import { computed, inject, Injectable, signal } from '@angular/core';
import { DirEntry } from '../../core/fs/fs.models';
import { SearchHit } from '../../core/search/search.models';
import { Side } from '../../core/session/session.models';
import { DISPLAY } from '../../core/settings/display';
import { acceptsValue, SCHEMA } from '../../core/settings/settings.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { recallDialog, rememberDialog } from '../../shared/dialog-memory';
import { DialogService } from '../../shared/dialog/dialog.service';
import { formatSize } from '../../shared/format';
import { FileTypesStore } from '../config/file-types.store';
import { otherSide, WorkspaceStore } from '../workspace/workspace.store';
import {
  ConditionKind,
  ConditionSpec,
  DEFAULT_SELECT_IF_RULE,
  defaultCondition,
  evaluateSelectIf,
  MAX_CONDITIONS,
  MAX_TEMPLATE_LABEL,
  MAX_TEMPLATES,
  PreviewRole,
  restoreSelectIfRule,
  restoreSelectIfTemplates,
  SelectIfEvaluation,
  SelectIfProblem,
  SelectIfRule,
  SelectIfTemplate,
} from './select-if-engine';
import { SI_TEXTS } from './select-if-texts';

export interface SelectIfRequest {
  readonly side: Side;
  readonly entries: readonly DirEntry[];
  readonly otherEntries: readonly DirEntry[];
  readonly hasOtherPanelEntries: boolean;
  readonly currentMarks: ReadonlySet<string>;
  readonly unmarkablePaths: ReadonlySet<string>;
  readonly hasSubfolders: boolean;
  readonly openedAtMs: number;
}

export interface SelectIfGridRow {
  readonly nr: number;
  readonly path: string;
  readonly name: string;
  readonly folder: string;
  readonly roleText: string;
  readonly sizeText: string;
  readonly role: PreviewRole;
}

let condSeq = 10;

export function describeProblem(p: SelectIfProblem): string {
  const t = SI_TEXTS.problems;
  switch (p.code) {
    case 'unknownCategory':
      return t.unknownCategory(p.detail ?? '');
    case 'emptyPattern':
      return t.emptyPattern;
    case 'invalidRegex':
      return t.invalidRegex(p.detail ?? '');
    case 'invalidNumber':
      return t.invalidNumber;
    case 'invalidDate':
      return t.invalidDate;
    case 'invalidRange':
      return t.invalidRange;
    case 'noConditions':
      return t.noConditions;
  }
}

/**
 * State and actions of the "Select if…" dialog (OPEN_SELECT_IF_DLG, design 046).
 * Evaluates `rule()` live against the active panel's displayed entries (and the
 * opposite panel when `otherPanel` is used), persists user templates in
 * `selectIf.templates` and remembers the last applied rule in `dialogs.recent`.
 */
@Injectable({ providedIn: 'root' })
export class SelectIfStore {
  private readonly ws = inject(WorkspaceStore);
  private readonly dialogs = inject(DialogService);
  private readonly settings = inject(SettingsStore);
  private readonly fileTypes = inject(FileTypesStore);
  private recalled = false;

  readonly request = signal<SelectIfRequest | null>(null);
  readonly rule = signal<SelectIfRule>(DEFAULT_SELECT_IF_RULE);
  readonly showExcluded = signal(false);

  readonly categories = computed(() => this.fileTypes.categories());
  readonly templates = computed<readonly SelectIfTemplate[]>(() =>
    restoreSelectIfTemplates(this.settings.get('selectIf.templates')),
  );

  readonly evaluation = computed<SelectIfEvaluation>(() => {
    const req = this.request();
    const sizeBase: 1000 | 1024 = DISPLAY.sizeFormat() === 'decimal' ? 1000 : 1024;
    if (!req) {
      return evaluateSelectIf([], this.rule(), {
        categories: this.categories(),
        sizeBase,
      });
    }
    return evaluateSelectIf(req.entries, this.rule(), {
      categories: this.categories(),
      otherEntries: req.otherEntries,
      currentMarks: req.currentMarks,
      unmarkablePaths: req.unmarkablePaths,
      sizeBase,
      nowMs: req.openedAtMs,
    });
  });

  readonly previewRows = computed<readonly SelectIfGridRow[]>(() => {
    const ev = this.evaluation();
    const includeExcluded = this.showExcluded();
    const unmarking = this.rule().combineMode === 'remove';
    const roles = SI_TEXTS.roles;
    const rows: SelectIfGridRow[] = [];
    for (const item of ev.previewItems) {
      if (item.role === 'excluded' && !includeExcluded) {
        continue;
      }
      const roleText =
        item.role === 'excluded'
          ? roles.excluded
          : item.role === 'primary'
            ? unmarking
              ? roles.unmarkPrimary
              : roles.primary
            : unmarking
              ? roles.unmarkCompanion
              : roles.companion;
      rows.push({
        nr: rows.length + 1,
        path: item.entry.path,
        name: item.entry.name,
        folder: (item.entry as Partial<SearchHit>).relDir ?? '',
        roleText,
        sizeText: formatSize(item.entry.size),
        role: item.role,
      });
    }
    return rows;
  });

  readonly summaryText = computed(() => {
    const ev = this.evaluation();
    if (ev.problems.length > 0) {
      return '';
    }
    const mode = this.rule().combineMode;
    const t = SI_TEXTS;
    switch (mode) {
      case 'replace':
        return t.summaryReplace(
          ev.nextMarkedPaths.size,
          ev.totalEntries,
          ev.rulePrimaryPaths.size,
          ev.ruleCompanionPaths.size,
          formatSize(ev.nextMarkedBytes),
        );
      case 'add':
        return t.summaryAdd(
          ev.addedCount,
          ev.nextMarkedPaths.size,
          ev.totalEntries,
          formatSize(ev.nextMarkedBytes),
        );
      case 'remove':
        return t.summaryRemove(ev.removedCount, ev.nextMarkedPaths.size, ev.totalEntries);
      case 'intersect':
        return t.summaryIntersect(
          ev.nextMarkedPaths.size,
          ev.totalEntries,
          formatSize(ev.nextMarkedBytes),
        );
    }
  });

  readonly canApply = computed(
    () => this.request() !== null && this.evaluation().problems.length === 0,
  );

  canOpen(): boolean {
    const panel = this.ws.panel();
    if (!panel) {
      return false;
    }
    const entries = panel.controller()?.displayedEntries() ?? panel.store.visibleEntries();
    return entries.some(
      (e) => e.name !== '..' && !e.path.startsWith('\0') && !panel.store.isUnmarkable(e.path),
    );
  }

  /** Captures the active and opposite panel state and recalls the last rule on first open. */
  prepare(nowMs = Date.now()): boolean {
    const side = this.ws.activeSide();
    const panel = this.ws.panel(side);
    if (!panel) {
      return false;
    }
    if (!this.recalled) {
      this.recalled = true;
      const kept = recallDialog(this.settings, 'selectIf');
      if (kept !== undefined) {
        this.rule.set(restoreSelectIfRule(kept));
      }
    }
    const entries = panel.controller()?.displayedEntries() ?? panel.store.visibleEntries();
    const unmarkablePaths = new Set<string>();
    let hasSubfolders = false;
    for (const e of entries) {
      if (panel.store.isUnmarkable(e.path)) {
        unmarkablePaths.add(e.path);
      }
      if (!hasSubfolders && Boolean((e as Partial<SearchHit>).relDir)) {
        hasSubfolders = true;
      }
    }
    const other = this.ws.panel(otherSide(side));
    const otherEntries = other
      ? (other.controller()?.displayedEntries() ?? other.store.visibleEntries())
      : [];
    this.request.set({
      side,
      entries,
      otherEntries,
      hasOtherPanelEntries: otherEntries.length > 0,
      currentMarks: new Set(panel.store.marked()),
      unmarkablePaths,
      hasSubfolders,
      openedAtMs: nowMs,
    });
    return true;
  }

  open(nowMs = Date.now()): void {
    if (this.prepare(nowMs)) {
      this.dialogs.show('select-if');
    }
  }

  ensurePrepared(): void {
    if (this.request() === null) {
      this.prepare();
    }
  }

  setRule(next: SelectIfRule): void {
    this.rule.set(next);
  }

  patchRule(patch: Partial<SelectIfRule>): void {
    this.rule.set({ ...this.rule(), ...patch });
  }

  addCondition(kind: ConditionKind = 'companion'): void {
    const cur = this.rule();
    if (cur.conditions.length >= MAX_CONDITIONS) {
      return;
    }
    const next = defaultCondition(kind, `c${++condSeq}`);
    this.patchRule({ conditions: [...cur.conditions, next] });
  }

  removeCondition(id: string): void {
    const cur = this.rule();
    if (cur.conditions.length <= 1) {
      return;
    }
    this.patchRule({ conditions: cur.conditions.filter((c) => c.id !== id) });
  }

  replaceCondition(id: string, next: ConditionSpec): void {
    const cur = this.rule();
    this.patchRule({
      conditions: cur.conditions.map((c) => (c.id === id ? next : c)),
    });
  }

  changeConditionKind(id: string, kind: ConditionKind): void {
    this.replaceCondition(id, defaultCondition(kind, id));
  }

  saveTemplate(rawLabel: string): boolean {
    const label = rawLabel.trim().slice(0, MAX_TEMPLATE_LABEL);
    if (!label) {
      return false;
    }
    const wanted = label.toLowerCase();
    const current = this.templates();
    const existingIdx = current.findIndex((t) => t.label.toLowerCase() === wanted);
    const entry: SelectIfTemplate = {
      label: existingIdx >= 0 ? current[existingIdx].label : label,
      rule: this.rule(),
    };
    const next =
      existingIdx >= 0
        ? current.map((t, i) => (i === existingIdx ? entry : t))
        : [...current, entry];
    if (next.length > MAX_TEMPLATES || !acceptsValue(SCHEMA['selectIf.templates'], next)) {
      return false;
    }
    this.settings.set('selectIf.templates', next);
    return true;
  }

  deleteTemplate(label: string): void {
    const wanted = label.trim().toLowerCase();
    const next = this.templates().filter((t) => t.label.toLowerCase() !== wanted);
    this.settings.set('selectIf.templates', next);
  }

  /** Applies `nextMarkedPaths` to the active panel and remembers the rule; returns `false` if invalid. */
  apply(): boolean {
    const req = this.request();
    const ev = this.evaluation();
    if (!req || ev.problems.length > 0) {
      return false;
    }
    const panel = this.ws.panel(req.side);
    if (panel) {
      const ctrl = panel.controller();
      if (ctrl) {
        ctrl.replaceMarks(ev.nextMarkedPaths);
      } else {
        panel.store.replaceMarks(
          req.entries.map((e) => e.path),
          ev.nextMarkedPaths,
        );
      }
    }
    rememberDialog(this.settings, 'selectIf', this.rule());
    this.close();
    return true;
  }

  close(): void {
    this.request.set(null);
    if (this.dialogs.open() === 'select-if') {
      this.dialogs.close();
    }
  }
}
