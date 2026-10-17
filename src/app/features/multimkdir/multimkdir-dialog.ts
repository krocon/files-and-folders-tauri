import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Modal } from '../../shared/dialog/modal';
import { GridColumn, PreviewGrid } from '../../shared/preview-grid/preview-grid';
import { LetterCase, MkdirTemplate } from './mkdir-engine';
import { MM_TEXTS } from './multimkdir-texts';
import { MkdirRow, MultiMkdirStore } from './multimkdir.store';

const LABEL_ID = 'fnf-mm-preview-label';
const CASES: readonly LetterCase[] = ['none', 'upper', 'lower'];

const COLUMNS: readonly GridColumn[] = [
  { property: 'nr', label: MM_TEXTS.colNr, width: 56, align: 'end' },
  { property: 'name', label: MM_TEXTS.colName, width: null },
  { property: 'info', label: MM_TEXTS.colInfo, width: 220 },
];

function rowClass(r: MkdirRow): string | null {
  return r.error ? 'fnf-mr-error' : null;
}

/** Multi-MkDir (OPEN_MULTIMKDIR_DLG, design 008 E4): template, counter, case, preview. */
@Component({
  selector: 'app-multi-mkdir-dialog',
  imports: [Modal, PreviewGrid],
  template: `
    @if (mm.request(); as req) {
      <app-modal [heading]="heading()" width="min(46rem, 92vw)" height="70vh" (closed)="mm.close()">
        <div class="tool">
          <p class="help">
            {{ t.inFolder }}: <span class="path">{{ req.parent }}</span>
          </p>
          <label class="field">
            <span>{{ t.template }}</span>
            <input
              type="text"
              data-autofocus
              spellcheck="false"
              autocomplete="off"
              aria-describedby="fnf-mm-help"
              [value]="v().template"
              (input)="set('template', text($event))"
              (keydown.enter)="$event.preventDefault(); mm.run()"
            />
          </label>
          <p id="fnf-mm-help" class="help">{{ t.templateHelp }}</p>
          <div class="row">
            @for (k of numbers; track k.key) {
              <label class="field num">
                <span>{{ k.label }}</span>
                <input
                  type="number"
                  [min]="k.key === 'step' ? 1 : k.key === 'digits' ? 0 : null"
                  [value]="v()[k.key]"
                  (input)="setNumber(k.key, $event)"
                />
              </label>
            }
            <label class="field">
              <span>{{ t.letterCase }}</span>
              <select (change)="set('letterCase', $any(text($event)))">
                @for (c of cases; track c) {
                  <option [value]="c" [selected]="c === v().letterCase">{{ t.cases[c] }}</option>
                }
              </select>
            </label>
          </div>
          <span [id]="labelId" class="preview-label">{{ t.preview }}</span>
          <app-preview-grid
            class="preview"
            [columns]="columns"
            [rows]="mm.rows()"
            [rowClass]="rowClass"
            [labelledBy]="labelId"
          />
          <div class="foot">
            <p class="error" role="alert">{{ mm.outcome().error ?? mm.runError() ?? '' }}</p>
            <div class="buttons">
              <button type="button" class="btn" (click)="mm.close()">{{ t.cancel }}</button>
              <button
                type="button"
                class="btn primary"
                [disabled]="!mm.canRun()"
                (click)="mm.run()"
              >
                {{ t.create }}
              </button>
            </div>
          </div>
        </div>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiMkdirDialog {
  protected readonly t = MM_TEXTS;
  protected readonly mm = inject(MultiMkdirStore);
  protected readonly v = this.mm.template;
  protected readonly cases = CASES;
  protected readonly columns = COLUMNS;
  protected readonly rowClass = rowClass;
  protected readonly labelId = LABEL_ID;
  protected readonly numbers: readonly {
    key: 'start' | 'end' | 'step' | 'digits';
    label: string;
  }[] = [
    { key: 'start', label: MM_TEXTS.start },
    { key: 'end', label: MM_TEXTS.end },
    { key: 'step', label: MM_TEXTS.step },
    { key: 'digits', label: MM_TEXTS.digits },
  ];
  protected readonly heading = computed(() => this.t.title(this.mm.outcome().names.length));

  protected set<K extends keyof MkdirTemplate>(key: K, value: MkdirTemplate[K]): void {
    this.mm.update({ [key]: value } as Partial<MkdirTemplate>);
  }

  protected setNumber(key: 'start' | 'end' | 'step' | 'digits', evt: Event): void {
    const raw = (evt.target as HTMLInputElement).value;
    this.set(key, raw === '' ? Number.NaN : Number(raw));
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
