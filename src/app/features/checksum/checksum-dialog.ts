import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CHECKSUM_ALGOS, ChecksumAlgo } from '../../core/checksum/checksum.models';
import { Modal } from '../../shared/dialog/modal';
import { CS_TEXTS } from './checksum-texts';
import { ChecksumMode, ChecksumStore } from './checksum.store';

const ALGO_LABELS: Readonly<Record<ChecksumAlgo, string>> = {
  sha256: 'SHA-256',
  sha512: 'SHA-512',
  sha1: 'SHA-1',
  md5: 'MD5',
};

/** Create checksums (OPEN_CHECKSUM_CREATE_DLG, design 039): algorithm, one list or one file each. */
@Component({
  selector: 'app-checksum-dialog',
  imports: [Modal],
  template: `
    @if (cs.request(); as req) {
      <app-modal [heading]="heading()" width="min(40rem, 92vw)" (closed)="cs.close()">
        <form class="tool" (submit)="$event.preventDefault(); cs.run()">
          <p class="help">
            {{ t.inFolder }}: <span class="path">{{ req.folder }}</span>
          </p>
          <label class="field">
            <span>{{ t.algo }}</span>
            <select data-autofocus (change)="setAlgo($event)">
              @for (a of algos; track a) {
                <option [value]="a" [selected]="a === f().algo">{{ labels[a] }}</option>
              }
            </select>
          </label>
          <fieldset class="modes" role="radiogroup" [attr.aria-label]="t.output">
            @for (m of modes; track m.mode) {
              <label class="check">
                <input
                  type="radio"
                  name="fnf-checksum-mode"
                  [checked]="f().mode === m.mode"
                  (change)="cs.update({ mode: m.mode })"
                />
                {{ m.label }}
              </label>
            }
          </fieldset>
          @if (f().mode === 'list') {
            <label class="field">
              <span>{{ t.name }}</span>
              <input
                type="text"
                spellcheck="false"
                autocomplete="off"
                [value]="cs.name()"
                (input)="cs.setName($any($event.target).value)"
              />
            </label>
            @if (cs.nameExists()) {
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="cs.overwrite()"
                  (change)="cs.overwrite.set($any($event.target).checked)"
                />
                {{ t.exists }}
              </label>
            }
          } @else {
            <p class="help">{{ t.perFileHelp }}</p>
          }
          <p class="help">{{ t.foldersHelp }}</p>
          <div class="foot">
            <p class="error" role="alert">{{ cs.runError() ?? '' }}</p>
            <div class="buttons">
              <button type="button" class="btn" (click)="cs.close()">{{ t.cancel }}</button>
              <button type="submit" class="btn primary" [disabled]="!cs.canRun()">
                {{ t.create }}
              </button>
            </div>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: '../../shared/dialog/tool-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecksumDialog {
  protected readonly t = CS_TEXTS;
  protected readonly cs = inject(ChecksumStore);
  protected readonly f = this.cs.form;
  protected readonly algos = CHECKSUM_ALGOS;
  protected readonly labels = ALGO_LABELS;
  protected readonly heading = computed(() => this.t.title(this.cs.request()?.entries.length ?? 0));

  protected get modes(): readonly { mode: ChecksumMode; label: string }[] {
    return [
      { mode: 'list', label: this.t.outputList },
      { mode: 'perFile', label: this.t.outputPerFile },
    ];
  }

  protected setAlgo(evt: Event): void {
    this.cs.update({ algo: (evt.target as HTMLSelectElement).value as ChecksumAlgo });
  }
}
