import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { dialogError } from './ops-logic';
import { OPS_TEXTS } from './ops-texts';
import { OpsStore } from './ops.store';

/**
 * One name: create folder (F7, `a/b/c` allowed, series suggestion), create
 * file (Shift+F4), rename (Shift+F6 – the extension is not selected). Errors
 * stay in the dialog; a root/home/system path offers "Rename anyway".
 */
@Component({
  selector: 'app-name-dialog',
  imports: [Modal],
  template: `
    @if (req(); as r) {
      <app-modal [heading]="texts().title" (closed)="ops.close()">
        <form class="form" (submit)="submit($event)">
          <label class="field">
            <span>{{ texts().label }}</span>
            <input
              #nameInput
              data-autofocus
              type="text"
              spellcheck="false"
              autocomplete="off"
              [value]="value()"
              (input)="value.set($any($event.target).value); error.set(null)"
              [attr.aria-invalid]="error() ? 'true' : null"
              aria-describedby="fnf-name-error fnf-name-help"
            />
          </label>
          @if (r.kind === 'mkdir') {
            <p id="fnf-name-help" class="help">{{ t.mkdirHelp }}</p>
          }
          @if (r.kind === 'rename') {
            <p class="help path">{{ r.entry?.path }}</p>
          }
          <p id="fnf-name-error" class="error" role="alert">
            @if (error(); as e) {
              {{ errorText(e) }}
            }
          </p>
          <div class="buttons">
            <button type="button" class="btn" (click)="ops.close()">{{ t.cancel }}</button>
            <button type="submit" class="btn primary" [disabled]="busy()">
              {{ dangerous() ? t.renameAnyway : texts().confirm }}
            </button>
          </div>
        </form>
      </app-modal>
    }
  `,
  styleUrl: './ops-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NameDialog {
  protected readonly t = OPS_TEXTS;
  protected readonly ops = inject(OpsStore);
  protected readonly req = this.ops.name;
  protected readonly value = signal(this.req()?.initial ?? '');
  protected readonly error = signal<FsError | null>(this.req()?.error ?? null);
  protected readonly busy = signal(false);
  /** Rust refused a root/home/system path: the next submit confirms it. */
  protected readonly dangerous = computed(() => this.error()?.code === 'dangerous_path');
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly texts = computed(() => {
    switch (this.req()?.kind) {
      case 'createFile':
        return {
          title: this.t.createFileTitle,
          label: this.t.createFileLabel,
          confirm: this.t.createFileConfirm,
        };
      case 'rename':
        return {
          title: this.t.renameTitle,
          label: this.t.renameLabel,
          confirm: this.t.renameConfirm,
        };
      default:
        return { title: this.t.mkdirTitle, label: this.t.mkdirLabel, confirm: this.t.mkdirConfirm };
    }
  });

  constructor() {
    // after the modal selected everything: rename selects the name without its extension
    afterNextRender(() => {
      const el = this.input()?.nativeElement;
      const end = this.req()?.selectEnd;
      if (el && end !== undefined) {
        setTimeout(() => el.setSelectionRange(0, end));
      }
    });
  }

  protected errorText(e: FsError): string {
    return dialogError(e);
  }

  protected submit(evt: Event): void {
    evt.preventDefault();
    void this.run();
  }

  private async run(): Promise<void> {
    const req = this.req();
    if (!req || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      this.error.set(await this.ops.runName(req, this.value(), this.dangerous()));
    } finally {
      this.busy.set(false);
    }
  }
}
