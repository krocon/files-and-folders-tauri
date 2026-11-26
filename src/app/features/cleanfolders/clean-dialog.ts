import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { RELEASE_EXTRAS, SAMPLE_SHAPES, VIDEO_EXTENSIONS } from '../../core/folders/release-extras';
import { DEFAULT_JUNK } from '../../core/folders/folders.models';
import { Modal } from '../../shared/dialog/modal';
import { DialogKey, DialogKeySpec } from '../../shared/dialog/dialog-key';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { formatSize } from '../../shared/format';
import { ProposalNote } from '../mcp/proposal-note';
import { MCP_TEXTS } from '../mcp/mcp-texts';
import {
  CLEAN_PROFILES,
  CleanForm,
  detailRowClass,
  loosened,
  MAX_LIMIT_MB,
  rootCellClass,
  rootRowClass,
} from './clean-logic';
import { CL_TEXTS } from './clean-texts';
import { CleanFoldersStore } from './clean.store';

const LABEL_ID = 'fnf-cl-list-label';
const DETAILS_ID = 'fnf-cl-details-label';
const HELP_ID = 'fnf-cl-keys-help';
const PAGE = 10;

/**
 * Clean folders (OPEN_DELETE_EMPTY_FOLDERS_DLG, design 008 §4, 077 E7): the profile
 * (what counts as an extra), one row per start folder with its verdict – leftover,
 * partly, stays – what goes and why the rest stays, the details of the folder under
 * the cursor, trash (default) or permanent. Enter cleans up to the trash only.
 */
@Component({
  selector: 'app-clean-folders-dialog',
  imports: [Modal, DialogKey, PreviewGrid, ProposalNote],
  template: `
    @if (cl.request(); as req) {
      <app-modal [heading]="heading()" width="min(72rem, 94vw)" height="86vh" (closed)="cl.close()">
        <div class="tool">
          @if (req.changedBy; as client) {
            <app-proposal-note [client]="client" [changed]="true" />
          }
          <fieldset class="row profiles">
            <legend>{{ t.profile }}</legend>
            @for (p of profiles; track p) {
              <label class="check">
                <input
                  type="radio"
                  name="fnf-cl-profile"
                  [attr.data-testid]="'clean-profile-' + p"
                  [checked]="f().profile === p"
                  (change)="set('profile', p)"
                />
                {{ t.profiles[p] }}
              </label>
            }
          </fieldset>
          <p class="help" data-testid="clean-profile-help">{{ t.profileHelp[f().profile] }}</p>
          <details class="rules" [open]="rulesOpen()" (toggle)="onRules($event)">
            <summary>
              {{ t.rules }}
              @if (isLoosened()) {
                <strong class="loosened" data-testid="clean-loosened">– {{ t.loosened }}</strong>
              }
            </summary>
            @switch (f().profile) {
              @case ('empty') {
                <p class="help mono">{{ t.extras(junkNames) }}</p>
              }
              @case ('release') {
                <p class="help mono">{{ t.extras(extraNames) }}</p>
                <p class="help mono">{{ t.samples(sampleShapes, sampleEndings) }}</p>
                <div class="row">
                  <label class="inline">
                    {{ t.junkMax }}
                    <input
                      type="number"
                      class="num"
                      min="0"
                      [max]="maxMb"
                      [value]="f().junkMaxMb"
                      (change)="setMb('junkMaxMb', $event)"
                    />
                  </label>
                  <label class="inline">
                    {{ t.sampleMax }}
                    <input
                      type="number"
                      class="num"
                      min="0"
                      [max]="maxMb"
                      [value]="f().sampleMaxMb"
                      (change)="setMb('sampleMaxMb', $event)"
                    />
                  </label>
                </div>
                <div class="row">
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().junkDirsBesideContent"
                      (change)="set('junkDirsBesideContent', checked($event))"
                    />
                    {{ t.junkDirs }}
                  </label>
                </div>
              }
              @case ('custom') {
                <div class="row">
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().emptyDirs"
                      (change)="set('emptyDirs', checked($event))"
                    />
                    {{ t.emptyDirs }}
                  </label>
                </div>
                <div class="row">
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().junkOn"
                      [disabled]="!f().emptyDirs"
                      (change)="set('junkOn', checked($event))"
                    />
                    {{ t.junk }}
                  </label>
                  <label class="inline grow">
                    <input
                      type="text"
                      class="mono wide"
                      spellcheck="false"
                      [attr.aria-label]="t.junkField"
                      [disabled]="!f().junkOn || !f().emptyDirs"
                      [value]="f().junkText"
                      (input)="set('junkText', text($event))"
                    />
                  </label>
                </div>
                <div class="row">
                  <label class="inline">
                    {{ t.junkMax }}
                    <input
                      type="number"
                      class="num"
                      min="0"
                      [max]="maxMb"
                      [disabled]="!f().junkOn || !f().emptyDirs"
                      [value]="f().junkMaxMb"
                      (change)="setMb('junkMaxMb', $event)"
                    />
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().junkDirsBesideContent"
                      [disabled]="!f().junkOn || !f().emptyDirs"
                      (change)="set('junkDirsBesideContent', checked($event))"
                    />
                    {{ t.junkDirs }}
                  </label>
                </div>
                <div class="row">
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="f().patternsOn"
                      (change)="set('patternsOn', checked($event))"
                    />
                    {{ t.patterns }}
                  </label>
                  <label class="inline grow">
                    <input
                      type="text"
                      class="mono wide"
                      spellcheck="false"
                      [attr.aria-label]="t.patternsField"
                      [disabled]="!f().patternsOn"
                      [value]="f().patternsText"
                      (input)="set('patternsText', text($event))"
                    />
                  </label>
                </div>
              }
            }
          </details>
          <span [id]="labelId" class="preview-label">{{ t.listLabel }}</span>
          <div
            class="list"
            tabindex="0"
            data-testid="clean-list"
            [attr.data-autofocus]="req.changedBy ? null : ''"
            [attr.aria-labelledby]="labelId"
            [attr.aria-describedby]="helpId"
            (keydown)="onListKey($event)"
          >
            <app-preview-grid
              class="preview"
              [columns]="columns"
              [rows]="cl.rows()"
              [rowClass]="rootClass"
              [cellClass]="rootCellClass"
              [activeIndex]="cl.active()"
              [labelledBy]="labelId"
              (rowClick)="onRowClick($event)"
            />
          </div>
          <p [id]="helpId" class="help">{{ t.keysHelp }}</p>
          <p class="sr-only" aria-live="polite">{{ activeText() }}</p>
          <span [id]="detailsId" class="preview-label" data-testid="clean-details-label">{{
            detailsLabel()
          }}</span>
          <app-preview-grid
            class="preview details"
            [columns]="detailColumns"
            [rows]="cl.details()"
            [rowClass]="detailClass"
            [labelledBy]="detailsId"
          />
          @if (cl.suggestRelease()) {
            <p class="hint" role="note" data-testid="clean-try-release">
              <span>{{ t.tryRelease }}</span>
              <button
                type="button"
                class="btn"
                appDialogKey="secondary:R"
                (click)="set('profile', 'release')"
              >
                {{ t.tryReleaseButton }}
              </button>
            </p>
          }
          <div class="foot">
            <p class="summary" aria-live="polite" data-testid="clean-summary">{{ summary() }}</p>
            <p class="error" role="alert">{{ errorText() }}</p>
            <fieldset class="modes">
              <legend class="sr-only">{{ t.mode }}</legend>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-cl-mode"
                  [checked]="cl.mode() === 'trash'"
                  (change)="cl.mode.set('trash')"
                />
                {{ t.trash }}
              </label>
              <label class="check">
                <input
                  type="radio"
                  name="fnf-cl-mode"
                  [checked]="cl.mode() === 'permanent'"
                  (change)="cl.mode.set('permanent')"
                />
                {{ t.permanent }}
              </label>
            </fieldset>
            <div class="buttons">
              @if (req.changedBy) {
                <div class="help">{{ mcp.proposalKeys }}</div>
              }
              <button
                appDialogKey="cancel"
                type="button"
                class="btn"
                [attr.data-autofocus]="req.changedBy ? '' : null"
                (click)="cl.close()"
              >
                {{ t.cancel }}
              </button>
              <button
                [appDialogKey]="runKey()"
                type="button"
                class="btn"
                data-testid="clean-run"
                [class.primary]="cl.mode() === 'trash'"
                [class.danger]="cl.mode() === 'permanent'"
                [disabled]="!cl.canRun()"
                (click)="cl.run()"
              >
                {{ cl.mode() === 'trash' ? t.delete : t.deletePermanent }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  styles: `
    .grow {
      flex: 1;
      min-width: 12rem;
    }
    .wide {
      flex: 1;
    }
    .num {
      width: 6rem;
    }
    .profiles {
      border: 0;
      padding: 0;
      margin: 0;
    }
    .profiles legend {
      float: left;
      padding: 0;
      margin-right: var(--spacing-3);
      font-weight: 600;
    }
    .rules {
      margin: 0 0 var(--spacing-2);
    }
    .rules summary {
      cursor: pointer;
    }
    .loosened {
      color: var(--color-dialog-danger-text, var(--color-danger));
    }
    .rules .help {
      margin: var(--spacing-1) 0;
      overflow-wrap: anywhere;
    }
    .list {
      display: flex;
      flex: 2;
      min-height: 6rem;
    }
    .list:focus-visible {
      outline: 2px solid var(--color-focus-ring);
      outline-offset: 1px;
    }
    .details {
      flex: 1.4;
      min-height: 5rem;
    }
    .hint {
      display: flex;
      gap: var(--spacing-3);
      align-items: center;
      margin: var(--spacing-2) 0 0;
      padding: var(--spacing-2);
      border: 1px solid var(--color-accent);
      border-radius: var(--radius-sm);
    }
    .hint span {
      flex: 1;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CleanFoldersDialog {
  protected readonly t = CL_TEXTS;
  protected readonly mcp = MCP_TEXTS;
  protected readonly cl = inject(CleanFoldersStore);
  protected readonly f = this.cl.form;
  protected readonly profiles = CLEAN_PROFILES;
  protected readonly maxMb = MAX_LIMIT_MB;
  protected readonly labelId = LABEL_ID;
  protected readonly detailsId = DETAILS_ID;
  protected readonly helpId = HELP_ID;
  protected readonly rootClass = rootRowClass;
  protected readonly rootCellClass = rootCellClass;
  protected readonly detailClass = detailRowClass;
  protected readonly junkNames = DEFAULT_JUNK.join('; ');
  protected readonly extraNames = [...DEFAULT_JUNK, ...RELEASE_EXTRAS].join('; ');
  protected readonly sampleShapes = SAMPLE_SHAPES.join('; ');
  protected readonly sampleEndings = VIDEO_EXTENSIONS.join(', ');
  /** The form protects less than the defaults (kept from an earlier run): never hidden. */
  protected readonly isLoosened = computed(() => loosened(this.f()));
  /** The rules are folded away unless the profile is the user's own or they were loosened. */
  private readonly rulesToggled = signal<boolean | null>(null);
  protected readonly rulesOpen = computed(
    () => this.rulesToggled() ?? (this.f().profile === 'custom' || this.isLoosened()),
  );

  // built when the dialog opens: the labels are in the language of that moment
  protected readonly columns: readonly GridColumn[] = [
    { property: 'check', label: '', width: 34 },
    { property: 'name', label: CL_TEXTS.colFolder, width: null },
    { property: 'verdict', label: CL_TEXTS.colVerdict, width: 96 },
    { property: 'removes', label: CL_TEXTS.colRemoves, width: 230 },
    { property: 'keeps', label: CL_TEXTS.colKeeps, width: 300 },
  ];
  protected readonly detailColumns: readonly GridColumn[] = [
    { property: 'what', label: CL_TEXTS.colWhat, width: 64 },
    { property: 'entry', label: CL_TEXTS.colEntry, width: null },
    { property: 'size', label: '', width: 90, align: 'end' },
    { property: 'info', label: CL_TEXTS.colInfo, width: null },
  ];

  protected readonly heading = computed(() => {
    const req = this.cl.request();
    if (!req) {
      return '';
    }
    return this.t.title(
      req.roots.length === 1 ? req.roots[0] : this.t.foldersIn(req.roots.length, req.folder),
    );
  });

  protected readonly detailsLabel = computed(() => {
    const root = this.cl.activeRoot();
    return root ? this.t.details(root.name) : this.t.detailsNone;
  });

  protected readonly activeText = computed(() => {
    const row = this.cl.rows()[this.cl.active()];
    return row ? this.t.activeRow(row.name, row.verdict, row.check === '☑') : '';
  });

  protected readonly summary = computed(() => {
    if (this.cl.scanning()) {
      return this.t.scanning;
    }
    const scan = this.cl.scan();
    const req = this.cl.request();
    if (!scan || !req) {
      return '';
    }
    const s = this.cl.sums();
    const parts = [
      s.roots > 0
        ? this.t.sum(s.roots, s.dirs, s.files, formatSize(s.bytes))
        : this.cl.offers()
          ? this.t.noneSelected
          : this.t.nothing,
    ];
    if (req.ignored > 0) {
      parts.push(this.t.ignoredFiles(req.ignored));
    }
    const unreadable = scan.unreadable.length + scan.unreadableMore;
    if (unreadable > 0) {
      parts.push(this.t.unreadable(unreadable));
    }
    if (scan.truncated) {
      parts.push(this.t.truncated);
    }
    return parts.join(' · ');
  });

  protected readonly errorText = computed(() => {
    const e: FsError | null = this.cl.runError() ?? this.cl.scanError();
    return e ? `${describeFsError(e)} ${e.message}` : '';
  });

  /**
   * Keys (design 057/076): Enter cleans up to the trash; deleting permanently is never
   * Enter. Guarded for an MCP client (design 071): the trash needs Mod+Enter or a click,
   * deleting permanently has no key at all.
   */
  protected readonly runKey = computed<DialogKeySpec>(() => {
    const guarded = this.cl.request()?.changedBy !== undefined;
    if (this.cl.mode() === 'trash') {
      return guarded ? 'confirm' : 'primary';
    }
    return guarded ? null : 'destructive:D';
  });

  protected set<K extends keyof CleanForm>(key: K, value: CleanForm[K]): void {
    this.cl.update({ [key]: value } as Partial<CleanForm>);
  }

  protected setMb(key: 'junkMaxMb' | 'sampleMaxMb', evt: Event): void {
    const v = Math.round(Number((evt.target as HTMLInputElement).value));
    this.set(key, Number.isFinite(v) ? Math.max(0, Math.min(MAX_LIMIT_MB, v)) : this.f()[key]);
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected onRules(evt: Event): void {
    this.rulesToggled.set((evt.target as HTMLDetailsElement).open);
  }

  protected onRowClick(evt: { index: number; clickCount: number; column: string | null }): void {
    this.cl.moveActive(evt.index);
    if (evt.column === 'check' || evt.clickCount > 1) {
      this.cl.toggle(evt.index);
    }
  }

  /** The list is a widget (APG grid): its keys stay here (CLAUDE.md §4 exception). */
  protected onListKey(evt: KeyboardEvent): void {
    const cl = this.cl;
    const handled = (() => {
      switch (evt.key) {
        case 'ArrowDown':
          cl.moveActive(cl.active() + 1);
          return true;
        case 'ArrowUp':
          cl.moveActive(cl.active() - 1);
          return true;
        case 'PageDown':
          cl.moveActive(cl.active() + PAGE);
          return true;
        case 'PageUp':
          cl.moveActive(cl.active() - PAGE);
          return true;
        case 'Home':
          cl.moveActive(0);
          return true;
        case 'End':
          cl.moveActive(cl.rows().length - 1);
          return true;
        case ' ':
          cl.toggle(cl.active());
          return true;
      }
      return false;
    })();
    if (handled) {
      evt.preventDefault();
      evt.stopPropagation();
    }
  }
}
