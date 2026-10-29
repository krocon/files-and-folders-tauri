import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { SeriesTarget, TARGETS, TEMPLATES } from './series-engine';
import { SG_TEXTS } from './series-texts';
import { SeriesGridRow, SeriesGroupStore } from './series.store';

const LABEL_ID = 'fnf-sg-preview-label';
const CUSTOM = '__custom';

function columns(): readonly GridColumn[] {
  const t = SG_TEXTS;
  return [
    { property: 'nr', label: t.colNr, width: 56, align: 'end' },
    { property: 'source', label: t.colSource, width: null },
    { property: 'season', label: t.colSeason, width: 70, align: 'end' },
    { property: 'episode', label: t.colEpisode, width: 70, align: 'end' },
    { property: 'target', label: t.colTarget, width: 110 },
    { property: 'info', label: t.colInfo, width: 230 },
  ];
}

function rowClass(r: SeriesGridRow): string | null {
  const s = r.row.status;
  return s === 'invalid' ? 'fnf-mr-error' : s === 'ok' ? null : 'fnf-mr-unchanged';
}

/**
 * Group series by season (OPEN_SERIES_GROUP_DLG, design 045 E6): folder name
 * template, filters, target, preview grid; Copy (default, Ctrl/⌘+Enter) or Move
 * start one `group` job.
 */
@Component({
  selector: 'app-series-group-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (sg.request(); as req) {
      <app-modal [heading]="heading()" width="min(72rem, 96vw)" [fill]="true" (closed)="sg.close()">
        <div class="tool">
          <div class="row">
            <label class="field">
              <span>{{ t.template }}</span>
              <select data-autofocus (change)="setTemplate($event)">
                @for (tp of templates; track tp) {
                  <option [value]="tp" [selected]="!custom() && tp === o().template">
                    {{ tp }}
                  </option>
                }
                <option [value]="customValue" [selected]="custom()">{{ t.custom }}</option>
              </select>
            </label>
            @if (custom()) {
              <label class="field">
                <span>{{ t.customTemplate }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  [value]="o().template"
                  (input)="sg.update({ template: text($event) })"
                />
              </label>
            }
            <label class="field">
              <span>{{ t.target }}</span>
              <select (change)="setTarget($event)">
                @for (tg of targets; track tg) {
                  <option
                    [value]="tg"
                    [selected]="tg === sg.target()"
                    [disabled]="tg !== 'source' && req.otherDir === null"
                  >
                    {{ t.targets[tg] }}
                  </option>
                }
              </select>
            </label>
            <div class="row options">
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="o().subtitles"
                  (change)="sg.update({ subtitles: checked($event) })"
                />
                {{ t.subtitles }}
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="o().showIgnored"
                  (change)="sg.update({ showIgnored: checked($event) })"
                />
                {{ t.showIgnored }}
              </label>
            </div>
          </div>
          <div class="row">
            <label class="field grow">
              <span>{{ t.videos }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="o().videos"
                (input)="sg.update({ videos: text($event) })"
              />
            </label>
            <label class="field">
              <span>{{ t.junkDirs }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="o().junkDirs"
                (input)="sg.update({ junkDirs: text($event) })"
              />
            </label>
          </div>
          <div class="row">
            <label class="field grow">
              <span>{{ t.junk }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="o().junk"
                (input)="sg.update({ junk: text($event) })"
              />
            </label>
          </div>
          <div class="row options">
            <label class="check">
              <input
                type="checkbox"
                [checked]="o().cleanup"
                (change)="sg.update({ cleanup: checked($event) })"
              />
              {{ t.cleanup }}
            </label>
            <span class="help">
              {{ t.target }}: <span class="path">{{ targetText() }}</span>
              @if (req.otherDir === null) {
                {{ t.noOtherPanel }}
              }
            </span>
          </div>
          <span [id]="labelId" class="preview-label">
            {{ t.preview }}
            @if (sg.scanning()) {
              – {{ t.scanning }}
            }
          </span>
          <app-preview-grid
            class="preview"
            [columns]="columns"
            [rows]="sg.rows()"
            [rowClass]="rowClass"
            [labelledBy]="labelId"
          />
          @if (sg.hints().length > 0) {
            <p class="help hints">⚠ {{ sg.hints().join(' · ') }}</p>
          }
          <div class="foot">
            <p class="summary" aria-live="polite">{{ summary() }}</p>
            <p class="error" role="alert">{{ errorText() }}</p>
            <div class="buttons">
              <button type="button" class="btn" (click)="sg.close()">{{ t.cancel }}</button>
              <button type="button" class="btn" [disabled]="!sg.canRun()" (click)="sg.run('move')">
                {{ t.move }}
              </button>
              <button
                type="button"
                class="btn primary"
                [disabled]="!sg.canRun()"
                aria-keyshortcuts="Control+Enter Meta+Enter"
                (click)="sg.run('copy')"
              >
                {{ t.copy }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.css', './series-dialog.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class SeriesGroupDialog {
  protected readonly t = SG_TEXTS;
  protected readonly sg = inject(SeriesGroupStore);
  protected readonly o = this.sg.options;
  protected readonly templates = TEMPLATES;
  protected readonly targets = TARGETS;
  protected readonly customValue = CUSTOM;
  protected readonly columns = columns();
  protected readonly rowClass = rowClass;
  protected readonly labelId = LABEL_ID;
  /** The own template field is shown (also for a kept template that is no preset). */
  protected readonly custom = signal(!TEMPLATES.includes(this.sg.options().template));

  protected readonly heading = computed(() => {
    if (this.sg.scanning()) {
      return this.t.titleScanning;
    }
    const seasons = this.sg.plans().flatMap((sp) => sp.plan.seasons);
    return this.t.title(
      seasons.reduce((n, s) => n + s.count, 0),
      seasons.length,
    );
  });
  protected readonly summary = computed(() => {
    if (this.sg.scanning()) {
      return this.t.scanning;
    }
    const plans = this.sg.plans();
    const perSeason =
      plans.length === 1
        ? plans[0].plan.seasons.map((s) => `${s.folder}: ${s.count}`).join(' · ')
        : plans
            .map((sp) => `${sp.source.name}: ${sp.plan.seasons.reduce((n, s) => n + s.count, 0)}`)
            .join(' · ');
    const c = this.sg.counts();
    return this.t.summary(perSeason, c.ok, c.ignored, c.other);
  });
  protected readonly errorText = computed(() => {
    const e: FsError | null = this.sg.runError() ?? this.sg.scanError();
    return e ? `${describeFsError(e)} ${e.message}` : (this.sg.blocked() ?? '');
  });
  /** Where the season folders go – display only (` › ` is no path separator). */
  protected readonly targetText = computed(() => {
    const plans = this.sg.plans();
    const first = plans[0];
    if (!first) {
      return '';
    }
    if (plans.length > 1 && this.sg.target() === 'source') {
      return this.t.seriesCount(plans.length);
    }
    if (plans.length > 1 && this.sg.target() === 'otherSeries') {
      return `${first.root} › (${this.t.seriesCount(plans.length)})`;
    }
    return first.subdir !== null ? `${first.root} › ${first.subdir}` : first.root;
  });

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected setTarget(evt: Event): void {
    this.sg.update({ target: this.text(evt) as SeriesTarget });
  }

  protected setTemplate(evt: Event): void {
    const v = this.text(evt);
    if (v === CUSTOM) {
      this.custom.set(true);
      return;
    }
    this.custom.set(false);
    this.sg.update({ template: v });
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      void this.sg.run('copy');
    }
  }
}
