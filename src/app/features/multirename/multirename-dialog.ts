import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { FsError } from '../../core/fs/fs.models';
import { Modal } from '../../shared/dialog/modal';
import { insertAt, PreviewFilter } from './multirename-logic';
import { MR_TEXTS } from './multirename-texts';
import { MultiRenameStore } from './multirename.store';
import { PREVIEW_LABEL_ID, PreviewTable } from './preview-table';
import {
  CapitalizeMode,
  MACROS,
  macroReplacement,
  RenameRules,
  Replacement,
  RuleField,
} from './rename-engine';

const TOKENS = ['[N]', '[E]', '[C]', '[P]', '[Q]', '[R]', '[D]', '[T]', '[N0-3]'] as const;
const STARTS = [0, 1, 10, 100, 1000, 10000, 100000, 1000000];
/** Step "50" is 50 (the old versions had the value 30 behind the label). */
const STEPS = [1, 2, 5, 10, 20, 50, 100, 1000];
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MODES: readonly CapitalizeMode[] = [
  'none',
  'upper',
  'lower',
  'firstLetter',
  'words',
  'chicago',
];
const CATEGORIES = [...new Set(MACROS.map((m) => m.category))];

/**
 * Multi-rename (OPEN_MULTIRENAME_DLG, design 007 §4): pattern with token bar,
 * case, counter, options, four replacement rows with macros, the preview
 * table and presets. Strg/⌘+Enter renames (a dialog may handle its own keys).
 */
@Component({
  selector: 'app-multi-rename-dialog',
  imports: [Modal, PreviewTable],
  templateUrl: './multirename-dialog.html',
  styleUrl: './multirename-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class MultiRenameDialog {
  protected readonly t = MR_TEXTS;
  protected readonly mr = inject(MultiRenameStore);
  protected readonly tokens = TOKENS;
  protected readonly starts = STARTS;
  protected readonly steps = STEPS;
  protected readonly digits = DIGITS;
  protected readonly modes = MODES;
  protected readonly categories = CATEGORIES;
  protected readonly macros = MACROS;
  protected readonly previewLabelId = PREVIEW_LABEL_ID;
  protected readonly rows = this.mr.rows;
  protected readonly r = this.mr.rules;
  protected readonly presetName = signal<string | null>(null);
  protected readonly selectedPreset = signal<string | null>(null);
  private readonly patternInput = viewChild<ElementRef<HTMLInputElement>>('pattern');

  protected readonly heading = computed(() => this.t.title(this.mr.request()?.sources.length ?? 0));
  protected readonly summaryText = computed(() => {
    const s = this.mr.summary();
    const text = this.t.summary(s.ok, s.unchanged, s.errors);
    return s.pending > 0 ? `${text} · ${this.t.checking}` : text;
  });

  protected digitLabel(d: number): string {
    return '1'.padStart(d, '0');
  }

  protected errorFor(field: RuleField | string): string | null {
    return this.mr.ruleErrors().find((e) => e.field === field)?.message ?? null;
  }

  protected fsError(e: FsError): string {
    return `${describeFsError(e)} ${e.message}`;
  }

  protected set<K extends keyof RenameRules>(key: K, value: RenameRules[K]): void {
    this.mr.update({ [key]: value } as Partial<RenameRules>);
  }

  protected checked(evt: Event): boolean {
    return (evt.target as HTMLInputElement).checked;
  }

  protected text(evt: Event): string {
    return (evt.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected setCounter(key: 'start' | 'step' | 'digits', evt: Event): void {
    this.set('counter', { ...this.r().counter, [key]: Number(this.text(evt)) });
  }

  protected setRow(i: number, patch: Partial<Replacement>): void {
    const replacements = this.r().replacements.map((rep, k) =>
      k === i ? { ...rep, ...patch } : rep,
    );
    this.mr.update({ replacements });
  }

  protected applyMacro(i: number, evt: Event): void {
    const select = evt.target as HTMLSelectElement;
    const macro = MACROS[Number(select.value)];
    select.value = '';
    if (!macro) {
      return;
    }
    const replacements = this.r().replacements.map((rep, k) =>
      k === i ? macroReplacement(macro) : rep,
    );
    this.mr.update({ replacements, replaceEnabled: true });
  }

  protected macrosOf(category: string): { index: number; title: string; example: string }[] {
    return MACROS.map((m, index) => ({
      index,
      title: m.title,
      example: m.example,
      cat: m.category,
    }))
      .filter((m) => m.cat === category)
      .map(({ index, title, example }) => ({ index, title, example }));
  }

  /** Inserts a token at the caret of the pattern field and puts the focus back there. */
  protected insertToken(token: string): void {
    const el = this.patternInput()?.nativeElement;
    const value = this.r().pattern;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAt(value, start, end, token);
    this.set('pattern', next.value);
    if (el) {
      el.value = next.value;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    }
  }

  protected setFilter(f: PreviewFilter): void {
    this.mr.filter.set(f);
  }

  protected choosePreset(evt: Event): void {
    const v = this.text(evt);
    const name = v === '' ? null : v;
    this.selectedPreset.set(name);
    this.mr.applyPreset(name);
  }

  protected async savePreset(): Promise<void> {
    const name = this.presetName()?.trim() ?? '';
    if (name === '') {
      return;
    }
    await this.mr.savePreset(name);
    this.selectedPreset.set(name);
    this.presetName.set(null);
  }

  protected async deletePreset(): Promise<void> {
    const name = this.selectedPreset();
    if (name !== null) {
      await this.mr.deletePreset(name);
      this.selectedPreset.set(null);
    }
  }

  protected onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
      evt.preventDefault();
      evt.stopPropagation();
      void this.mr.run();
    }
  }
}
