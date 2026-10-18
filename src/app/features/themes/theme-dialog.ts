import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toFsError } from '../../core/fs/fs-error';
import { DARK, LIGHT } from '../../core/theme/builtin-themes';
import { pickedColor, Rgba, toHex } from '../../core/theme/color';
import {
  checkContrast,
  completeTokens,
  resolveColor,
  tokenValueOk,
} from '../../core/theme/theme-logic';
import { Theme } from '../../core/theme/theme.models';
import { ThemeDraft, ThemeService } from '../../core/theme/theme.service';
import { GROUP_LABELS, TOKENS, TokenDef, TokenGroup } from '../../core/theme/tokens';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { WorkspaceStore } from '../workspace/workspace.store';
import { THEME_TEXTS } from './theme-texts';

interface Row {
  readonly def: TokenDef;
  readonly value: string;
  /** `#rrggbb` for the picker, `null` = not a resolvable or a fully transparent colour. */
  readonly hex: string | null;
  /** The resolved colour (its alpha is kept when picking, review 013 #7). */
  readonly color: Rgba | null;
  readonly invalid: boolean;
  readonly warn: boolean;
}

interface Group {
  readonly label: string;
  readonly rows: readonly Row[];
}

function draftOf(t: Theme): ThemeDraft {
  return { name: t.name, dark: t.dark, tokens: completeTokens(t, LIGHT, DARK) };
}

function sameDraft(a: ThemeDraft, b: ThemeDraft): boolean {
  const ka = Object.keys(a.tokens);
  return (
    a.name === b.name &&
    a.dark === b.dark &&
    ka.length === Object.keys(b.tokens).length &&
    ka.every((k) => a.tokens[k] === b.tokens[k])
  );
}

const GROUP_ORDER = Object.keys(GROUP_LABELS) as TokenGroup[];

/**
 * Colour schemes (OPEN_THEMES_DLG, design 013 E6): selection (follow the
 * system / fixed), list of schemes (native radio group – arrows switch live),
 * live editor with colour picker + text per token, contrast hints,
 * save / save as / delete / reset, import (file under the cursor) and export
 * (into the active panel's folder). Closing discards unsaved edits.
 */
@Component({
  selector: 'app-theme-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.heading" width="min(60rem, 94vw)" height="82vh" (closed)="close()">
      <div class="themes">
        <div class="mode">
          <label class="check">
            <input
              type="checkbox"
              [checked]="sel().mode === 'system'"
              (change)="toggleSystem($any($event.target).checked)"
            />
            {{ t.followSystem }}
          </label>
          <label class="inline">
            {{ t.lightScheme }}
            <select
              [disabled]="sel().mode !== 'system'"
              (change)="theme.followSystem({ light: $any($event.target).value })"
            >
              @for (s of theme.themes(); track s.id) {
                <option [value]="s.id" [selected]="s.id === sel().light">{{ s.name }}</option>
              }
            </select>
          </label>
          <label class="inline">
            {{ t.darkScheme }}
            <select
              [disabled]="sel().mode !== 'system'"
              (change)="theme.followSystem({ dark: $any($event.target).value })"
            >
              @for (s of theme.themes(); track s.id) {
                <option [value]="s.id" [selected]="s.id === sel().dark">{{ s.name }}</option>
              }
            </select>
          </label>
        </div>

        <div class="body">
          <fieldset class="list" [attr.aria-describedby]="dirty() ? 'fnf-theme-unsaved' : null">
            <legend>{{ t.schemes }}</legend>
            @for (s of theme.themes(); track s.id) {
              <label class="scheme" [class.current]="s.id === editId()">
                <input
                  type="radio"
                  name="fnf-theme"
                  [value]="s.id"
                  [checked]="s.id === editId()"
                  [attr.data-autofocus]="s.id === editId() ? '' : null"
                  (change)="pick(s.id, $any($event.target))"
                />
                <span class="swatch" aria-hidden="true" [style.background]="swatch(s)"></span>
                <span class="sname">{{ s.name }}</span>
                @if (s.builtIn) {
                  <span class="tag">{{ t.builtIn }}</span>
                }
              </label>
            }
            @if (dirty()) {
              <p id="fnf-theme-unsaved" class="hint">{{ t.unsavedFirst }}</p>
            }
          </fieldset>

          <div class="editor">
            <div class="row head">
              <label class="field grow">
                <span>{{ t.name }}</span>
                <input
                  type="text"
                  spellcheck="false"
                  maxlength="100"
                  [value]="draft().name"
                  (input)="setName($any($event.target).value)"
                />
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="draft().dark"
                  (change)="setDark($any($event.target).checked)"
                />
                {{ t.dark }}
              </label>
            </div>

            <div class="contrast" role="status">
              @if (problems().length === 0) {
                <span class="ok">✓ {{ t.contrastOk }}</span>
              } @else {
                <span class="warn">⚠ {{ t.contrastProblems(problems().length) }}</span>
                <ul>
                  @for (r of problems(); track r.pair.label) {
                    <li>{{ t.ratio(r.pair.label, r.ratio, r.pair.min) }}</li>
                  }
                </ul>
              }
            </div>

            @for (g of groups(); track g.label) {
              <fieldset class="group">
                <legend>{{ g.label }}</legend>
                @for (r of g.rows; track r.def.name) {
                  <div class="token">
                    <span class="tlabel" [id]="labelId(r.def.name)">
                      {{ r.def.label }}
                      @if (r.warn) {
                        <span class="warn" [attr.title]="t.lowContrast">⚠</span>
                      }
                    </span>
                    @if (r.def.kind === 'color') {
                      <input
                        type="color"
                        [value]="r.hex ?? '#000000'"
                        [disabled]="r.hex === null"
                        [attr.aria-label]="t.pickColor(r.def.label)"
                        [attr.title]="r.hex === null ? t.noPicker : null"
                        (input)="pickColor(r, $any($event.target).value)"
                      />
                    } @else {
                      <span class="nopicker" aria-hidden="true"></span>
                    }
                    <input
                      type="text"
                      class="value"
                      spellcheck="false"
                      [value]="r.value"
                      [attr.aria-label]="t.valueOf(r.def.label)"
                      [attr.title]="r.def.name"
                      [attr.aria-invalid]="r.invalid ? 'true' : null"
                      (change)="setText(r.def.name, $any($event.target).value)"
                    />
                  </div>
                }
              </fieldset>
            }
          </div>
        </div>

        <p class="msg" role="status">{{ message() }}</p>
        <div class="buttons">
          <span class="help">{{ t.importHelp }}</span>
          <button type="button" class="btn" (click)="importFile()">{{ t.import }}</button>
          <button type="button" class="btn" (click)="exportFile()">{{ t.export }}</button>
          <button type="button" class="btn" (click)="exportFile(true)">{{ t.exportLegacy }}</button>
          <span class="spacer"></span>
          <button type="button" class="btn" [disabled]="!isOwn()" (click)="remove()">
            {{ t.delete }}
          </button>
          <button type="button" class="btn" [disabled]="!dirty()" (click)="reset()">
            {{ t.reset }}
          </button>
          <button type="button" class="btn" [disabled]="hasInvalid()" (click)="saveAs()">
            {{ t.saveAs }}
          </button>
          <button
            type="button"
            class="btn primary"
            [disabled]="!isOwn() || !(dirty() || !isActive()) || hasInvalid()"
            [attr.title]="isOwn() ? null : t.builtInReadOnly"
            (click)="save()"
          >
            {{ t.save }}
          </button>
          <button type="button" class="btn" (click)="close()">{{ t.close }}</button>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['../../shared/dialog/tool-dialog.scss', './theme-dialog.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeDialog {
  protected readonly theme = inject(ThemeService);
  private readonly dialogs = inject(DialogService);
  private readonly ws = inject(WorkspaceStore);
  protected readonly t = THEME_TEXTS;

  protected readonly sel = this.theme.selection;
  protected readonly editId = signal(this.theme.active().id);
  private readonly original = computed(() => this.theme.find(this.editId()) ?? this.theme.active());
  protected readonly draft = signal<ThemeDraft>(draftOf(this.theme.active()));
  private readonly invalid = signal<ReadonlySet<string>>(new Set());
  protected readonly message = signal('');

  protected readonly dirty = computed(() => !sameDraft(this.draft(), draftOf(this.original())));
  protected readonly isOwn = computed(() => !this.original().builtIn);
  /** The scheme in the editor is the one on screen (an import with contrast problems is not). */
  private readonly isActive = computed(() => this.editId() === this.theme.active().id);
  protected readonly hasInvalid = computed(() => this.invalid().size > 0);
  private readonly contrast = computed(() => checkContrast(this.draft().tokens));
  protected readonly problems = computed(() => this.contrast().filter((r) => !r.ok));

  protected readonly groups = computed<Group[]>(() => {
    const tokens = this.draft().tokens;
    const invalid = this.invalid();
    const warn = new Set(this.problems().flatMap((r) => [r.pair.fg, r.pair.bg]));
    const row = (def: TokenDef): Row => {
      const c = def.kind === 'color' ? resolveColor(def.name, tokens) : null;
      return {
        def,
        value: tokens[def.name] ?? '',
        // no picker for `transparent`: picking would make it opaque
        hex: c && c.a > 0 ? toHex(c) : null,
        color: c,
        invalid: invalid.has(def.name),
        warn: warn.has(def.name),
      };
    };
    const groups: Group[] = GROUP_ORDER.map((g) => ({
      label: GROUP_LABELS[g],
      rows: TOKENS.filter((d) => d.group === g).map(row),
    }));
    const known = new Set(TOKENS.map((d) => d.name));
    const extra = Object.keys(tokens)
      .filter((k) => !known.has(k))
      .sort()
      .map((name) => row({ name, group: 'general', label: name, kind: 'color' }));
    if (extra.length) {
      groups.push({ label: this.t.more, rows: extra });
    }
    return groups;
  });

  constructor() {
    // live preview of unsaved edits; the active scheme otherwise
    effect(() => {
      const d = this.draft();
      const dirty = this.dirty();
      untracked(() => this.theme.preview.set(dirty ? d : null));
    });
    inject(DestroyRef).onDestroy(() => this.theme.preview.set(null));
  }

  protected labelId(name: string): string {
    return `fnf-theme-l${name}`;
  }

  protected swatch(s: Theme): string {
    const tokens = completeTokens(s, LIGHT, DARK);
    const bg = resolveColor('--color-list-bg', tokens);
    const fg = resolveColor('--color-cursor-bg', tokens);
    const a = bg ? toHex(bg) : '#fff';
    const b = fg ? toHex(fg) : '#000';
    return `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`;
  }

  protected toggleSystem(on: boolean): void {
    void (on ? this.theme.followSystem() : this.theme.select(this.theme.active().id));
  }

  protected pick(id: string, radio?: HTMLInputElement): void {
    if (this.dirty()) {
      // the native radio has moved already: put it back on the scheme in the editor (review 013 #4)
      if (radio) {
        radio.checked = false;
        const fieldset = radio.closest('fieldset');
        const current = [
          ...(fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []),
        ].find((r) => r.value === this.editId());
        if (current) {
          current.checked = true;
        }
      }
      this.message.set(this.t.unsavedFirst);
      return;
    }
    this.load(id);
    void this.theme.select(id);
  }

  protected setName(name: string): void {
    this.draft.update((d) => ({ ...d, name }));
  }

  protected setDark(dark: boolean): void {
    this.draft.update((d) => ({ ...d, dark }));
  }

  protected setToken(name: string, value: string): void {
    this.invalid.update((s) => without(s, name));
    this.draft.update((d) => ({ ...d, tokens: { ...d.tokens, [name]: value } }));
  }

  protected pickColor(row: Row, hex: string): void {
    this.setToken(row.def.name, pickedColor(hex, row.color));
  }

  protected setText(name: string, value: string): void {
    if (tokenValueOk(name, value)) {
      this.setToken(name, value.trim());
    } else {
      this.invalid.update((s) => new Set(s).add(name));
      this.message.set(`${name}: ${this.t.invalidValue}`);
    }
  }

  protected reset(): void {
    this.load(this.editId());
    this.message.set('');
  }

  protected async save(): Promise<void> {
    if (!this.isOwn() || this.hasInvalid()) {
      return;
    }
    await this.store(this.editId());
  }

  protected async saveAs(): Promise<void> {
    if (!this.hasInvalid()) {
      await this.store(undefined);
    }
  }

  protected async remove(): Promise<void> {
    const t = this.original();
    if (t.builtIn) {
      return;
    }
    await this.theme.deleteTheme(t.id);
    this.load(this.theme.active().id);
    this.message.set(this.t.deleted(t.name));
  }

  protected async importFile(): Promise<void> {
    if (this.dirty()) {
      this.message.set(this.t.unsavedFirst);
      return;
    }
    const entry = this.ws.panel()?.store.cursorEntry();
    if (!entry || entry.kind === 'directory') {
      this.message.set(this.t.noFile);
      return;
    }
    try {
      const r = await this.theme.importFile(entry.path);
      // with contrast problems it is only opened in the editor, not selected (review 013 #2)
      this.load(r.id);
      this.message.set(
        this.t.imported(r.name, r.unknown.length, r.dropped.length) +
          (r.adjusted ? ` ${this.t.adjusted(r.adjusted)}` : '') +
          (r.selected ? '' : ` ${this.t.notSelected(r.problems.length)}`),
      );
    } catch (err) {
      this.message.set(toFsError(err).message);
    }
  }

  /** `legacy`: the old `{ name, colors }` format (design 019). */
  protected async exportFile(legacy = false): Promise<void> {
    const side = this.ws.source();
    const store = this.ws.panel(side)?.store;
    const dir = store?.path() ?? null;
    if (!store || dir === null) {
      this.message.set(this.t.noFolder);
      return;
    }
    try {
      const path = legacy
        ? await this.theme.exportLegacy(dir, this.draft())
        : await this.theme.exportTheme(dir, this.draft());
      this.message.set(this.t.exported(path));
      void store.refresh();
    } catch (err) {
      this.message.set(toFsError(err).message);
    }
  }

  protected close(): void {
    this.theme.preview.set(null);
    this.dialogs.close();
  }

  private async store(id: string | undefined): Promise<void> {
    const draft = this.draft();
    try {
      const newId = await this.theme.saveTheme(draft, id);
      this.load(newId);
      this.message.set(this.t.saved(this.draft().name));
    } catch (err) {
      this.message.set(toFsError(err).message);
    }
  }

  private load(id: string): void {
    this.editId.set(id);
    this.invalid.set(new Set());
    this.draft.set(draftOf(this.original()));
  }
}

function without(s: ReadonlySet<string>, name: string): ReadonlySet<string> {
  if (!s.has(name)) {
    return s;
  }
  const next = new Set(s);
  next.delete(name);
  return next;
}
