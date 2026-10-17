import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { ActionService } from '../../core/actions/action.service';
import { strokeFromEvent, strokeToString } from '../../core/actions/shortcut';
import { ENCODINGS, EncodingId } from '../../core/preview/preview.models';
import { Modal } from '../../shared/dialog/modal';
import { formatSize } from '../../shared/format';
import { PreviewContent } from './preview-content';
import { previewNotes } from './preview-notes';
import { PV_TEXTS } from './preview-texts';
import { viewerStepFor } from './viewer-keys';
import { ViewerStore, ViewMode } from './viewer.store';

const MODES: readonly ViewMode[] = ['auto', 'text', 'hex'];

/** The viewer (F3, design 010 E1/E8) as a large modal over the window. */
@Component({
  selector: 'app-viewer-dialog',
  imports: [Modal, PreviewContent],
  template: `
    @if (v.entry(); as entry) {
      <app-modal
        [heading]="t.viewTitle(entry.name)"
        width="min(80rem, 96vw)"
        height="86vh"
        (closed)="v.close()"
        (keydown)="onKeydown($event)"
      >
        <div class="viewer">
          <div class="toolbar" role="toolbar" [attr.aria-label]="t.viewTitle(entry.name)">
            <button
              type="button"
              class="btn"
              [attr.aria-label]="t.previous"
              [attr.title]="t.previous"
              [disabled]="v.position().index <= 1"
              (click)="v.step(-1)"
            >
              ◀
            </button>
            <span class="pos">{{ t.position(v.position().index, v.position().count) }}</span>
            <button
              type="button"
              class="btn"
              [attr.aria-label]="t.next"
              [attr.title]="t.next"
              [disabled]="v.position().index >= v.position().count"
              (click)="v.step(1)"
            >
              ▶
            </button>
            <label class="field">
              <span>{{ t.mode }}</span>
              <select (change)="v.setMode($any(value($event)))">
                @for (m of modes; track m) {
                  <option [value]="m" [selected]="m === v.mode()">{{ t.modes[m] }}</option>
                }
              </select>
            </label>
            @if (isText()) {
              <label class="field">
                <span>{{ t.encoding }}</span>
                <select (change)="v.setEncoding($any(value($event)))">
                  <option value="auto" [selected]="v.encoding() === 'auto'">
                    {{ t.auto(v.encoding() === 'auto' ? detected() : null) }}
                  </option>
                  @for (e of encodings; track e) {
                    <option [value]="e" [selected]="e === v.encoding()">{{ e }}</option>
                  }
                </select>
              </label>
              <label class="check">
                <input type="checkbox" [checked]="v.wrap()" (change)="v.toggleWrap()" />
                {{ t.wrap }}
              </label>
            }
            @if (isImage()) {
              <button type="button" class="btn" (click)="v.zoom.set('fit')">{{ t.fit }}</button>
              <button type="button" class="btn" (click)="v.zoom.set(1)">{{ t.actual }}</button>
              <button
                type="button"
                class="btn"
                [attr.aria-label]="t.zoomOut"
                (click)="v.zoomStep(-1)"
              >
                −
              </button>
              <button
                type="button"
                class="btn"
                [attr.aria-label]="t.zoomIn"
                (click)="v.zoomStep(1)"
              >
                +
              </button>
            }
            <span class="meta">{{ meta() }}</span>
          </div>
          <div class="notes" role="status">
            @for (n of notes(); track n) {
              <p class="note">{{ n }}</p>
            }
            @if (v.error(); as e) {
              <p class="note error">{{ describe(e) }} – {{ e.message }}</p>
            }
          </div>
          <div
            #content
            class="content"
            role="document"
            tabindex="0"
            data-autofocus
            [attr.aria-busy]="v.loading()"
            [attr.aria-label]="entry.name"
          >
            @if (v.preview(); as p) {
              <app-preview-content [preview]="p" [context]="v.context()" />
            } @else if (v.loading()) {
              <p class="note">{{ t.loading }}</p>
            }
          </div>
          @if (isText()) {
            <div class="find" role="search">
              <label class="field">
                <span>{{ t.find }}</span>
                <input
                  #find
                  type="search"
                  spellcheck="false"
                  autocomplete="off"
                  [placeholder]="t.findPlaceholder"
                  [value]="v.query()"
                  (input)="v.setQuery(value($event))"
                  (keydown.enter)="onFindEnter($event)"
                />
              </label>
              <span class="count" aria-live="polite">{{ matchText() }}</span>
              <button
                type="button"
                class="btn"
                [attr.aria-label]="t.findPrev"
                (click)="v.findNext(-1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="btn"
                [attr.aria-label]="t.findNext"
                (click)="v.findNext(1)"
              >
                ↓
              </button>
              <span class="spacer"></span>
              <button type="button" class="btn" (click)="v.close()">{{ t.close }}</button>
            </div>
          } @else {
            <div class="find">
              <span class="spacer"></span>
              <button type="button" class="btn" (click)="v.close()">{{ t.close }}</button>
            </div>
          }
        </div>
      </app-modal>
    }
  `,
  styleUrl: './viewer-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewerDialog {
  protected readonly v = inject(ViewerStore);
  private readonly actions = inject(ActionService);
  protected readonly t = PV_TEXTS;
  protected readonly modes = MODES;
  protected readonly encodings: readonly EncodingId[] = ENCODINGS;
  private readonly findInput = viewChild<ElementRef<HTMLInputElement>>('find');
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');

  protected readonly isText = computed(() => this.v.preview()?.kind === 'text');
  protected readonly isImage = computed(() => this.v.preview()?.kind === 'image');
  protected readonly detected = computed(() => {
    const p = this.v.preview();
    return p?.kind === 'text' ? p.encoding : null;
  });
  protected readonly notes = computed(() =>
    previewNotes(this.v.preview(), this.v.entry()?.name ?? ''),
  );
  protected readonly meta = computed(() => {
    const p = this.v.preview();
    if (!p || p.kind === 'directory' || p.kind === 'other') {
      return '';
    }
    const enc = p.kind === 'text' ? ` · ${p.encoding}` : '';
    return `${p.format.label} · ${formatSize(p.size)}${enc}`;
  });
  protected readonly matchText = computed(() => {
    if (!this.v.query()) {
      return '';
    }
    return this.t.matches(this.v.current() + 1, this.v.matches().length, this.v.matchesCapped());
  });

  protected describe = describeFsError;

  protected value(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected onFindEnter(evt: Event): void {
    evt.preventDefault();
    this.v.findNext((evt as KeyboardEvent).shiftKey ? -1 : 1);
  }

  /** Dialog keys (an APG widget, allowed by CLAUDE.md §4). */
  protected onKeydown(evt: KeyboardEvent): void {
    const stroke = strokeFromEvent(evt, this.actions.platform());
    if (!stroke) {
      return;
    }
    const key = strokeToString(stroke);
    const target = evt.target as HTMLElement;
    const inField = target.tagName === 'INPUT' || target.tagName === 'SELECT';
    const handled = (): void => {
      evt.preventDefault();
      evt.stopPropagation();
    };
    if (key === 'Mod+F') {
      if (this.isText()) {
        const input = this.findInput()?.nativeElement;
        input?.focus();
        input?.select();
      }
      return handled();
    }
    if (key === 'F3' || key === 'Shift+F3') {
      this.v.findNext(key === 'F3' ? 1 : -1);
      return handled();
    }
    if (inField) {
      return;
    }
    const step = viewerStepFor(key, {
      tagName: target.tagName,
      inToolbar: !!target.closest?.('[role="toolbar"]'),
    });
    if (step !== null) {
      this.v.step(step);
      return handled();
    }
    switch (key) {
      case 'W':
        if (this.isText()) {
          this.v.toggleWrap();
          return handled();
        }
        return;
    }
    if (this.isImage()) {
      if (evt.key === '+' || evt.key === '=') {
        this.v.zoomStep(1, this.fitScale());
        return handled();
      }
      if (evt.key === '-') {
        this.v.zoomStep(-1, this.fitScale());
        return handled();
      }
      if (key === '0') {
        this.v.zoom.set('fit');
        return handled();
      }
      if (key === '1') {
        this.v.zoom.set(1);
        return handled();
      }
    }
  }

  /** Current scale of a fitted image (zooming starts from what is visible). */
  private fitScale(): number {
    const img = this.content()?.nativeElement.querySelector('img');
    return img && img.naturalWidth > 0 ? img.clientWidth / img.naturalWidth : 1;
  }
}
