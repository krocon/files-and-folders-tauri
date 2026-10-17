import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { ActionService } from '../actions/action.service';
import { toFsError } from '../fs/fs-error';
import { BUILT_IN_THEMES, DARK, LIGHT } from './builtin-themes';
import { toHex } from './color';
import { ThemeApi, ThemeFileContent } from './theme-api';
import {
  applicableToken,
  checkContrast,
  completeTokens,
  ContrastResult,
  diffTokens,
  ImportedTheme,
  newThemeId,
  normalizeImport,
  resolveColor,
  sanitizeTokens,
  uniqueName,
} from './theme-logic';
import { DEFAULT_SELECTION, Theme, ThemeSelection, ThemesFile } from './theme.models';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Result of an import: selected only without contrast problems. */
export interface ImportedScheme extends ImportedTheme {
  readonly id: string;
  readonly problems: readonly ContrastResult[];
  readonly selected: boolean;
}

export interface ThemeDraft {
  readonly name: string;
  readonly dark: boolean;
  readonly tokens: Readonly<Record<string, string>>;
}

/**
 * Colour schemes (design 013): built-in + own schemes, the selection (follow
 * the system / fixed), applying the active scheme to <html> (tokens inline,
 * `data-theme` for the GuiExpert Table, `color-scheme`, `theme-color`), a live
 * preview for the editor and saving through {@link ThemeApi}. Root service.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly api = inject(ThemeApi);
  private readonly actions = inject(ActionService);

  readonly userThemes = signal<readonly Theme[]>([]);
  readonly selection = signal<ThemeSelection>(DEFAULT_SELECTION);
  /** `prefers-color-scheme: dark`, live. */
  readonly systemDark = signal(false);
  /** The editor's unsaved scheme, shown instead of the active one. */
  readonly preview = signal<ThemeDraft | null>(null);
  readonly loaded = signal(false);

  /** Own schemes first (by name), then the built-in ones (mr). */
  readonly themes = computed<readonly Theme[]>(() => [
    ...[...this.userThemes()].sort((a, b) => a.name.localeCompare(b.name)),
    ...BUILT_IN_THEMES,
  ]);

  readonly activeId = computed(() => {
    const s = this.selection();
    if (s.mode === 'fixed') {
      return s.theme;
    }
    return this.systemDark() ? s.dark : s.light;
  });

  /** The active scheme; a missing id falls back to light/dark by the system. */
  readonly active = computed<Theme>(
    () =>
      this.find(this.activeId()) ??
      (this.selection().mode === 'fixed' ? LIGHT : this.systemDark() ? DARK : LIGHT),
  );

  /** What is on screen: the preview or the active scheme, completed from light/dark. */
  readonly applied = computed<ThemeDraft>(() => {
    const t = this.preview() ?? this.active();
    return { name: t.name, dark: t.dark, tokens: completeTokens(t, LIGHT, DARK) };
  });

  private persist = true;
  private saving: Promise<void> = Promise.resolve();
  private appliedNames = new Set<string>();

  constructor() {
    const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
    if (media) {
      this.systemDark.set(media.matches);
      const onChange = (e: MediaQueryListEvent) => this.systemDark.set(e.matches);
      media.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener?.('change', onChange));
    }
    effect(() => this.apply(this.applied()));
  }

  find(id: string): Theme | undefined {
    return this.themes().find((t) => t.id === id);
  }

  async init(): Promise<void> {
    try {
      const loaded = await this.api.load();
      this.userThemes.set(
        loaded.file.themes.map((t) => ({
          ...t,
          tokens: sanitizeTokens(t.tokens).tokens,
          builtIn: false,
        })),
      );
      this.selection.set({ ...DEFAULT_SELECTION, ...loaded.file.selection });
      if (loaded.warning) {
        this.actions.report(loaded.warning);
      }
    } catch (err) {
      const e = toFsError(err);
      if (e.code !== 'no_backend') {
        this.actions.report(`The colour schemes could not be loaded: ${e.message}`);
      }
    } finally {
      this.loaded.set(true);
    }
  }

  /** Fixed scheme. */
  select(id: string): Promise<void> {
    if (!this.find(id)) {
      return Promise.resolve();
    }
    this.selection.update((s) => ({ ...s, mode: 'fixed', theme: id }));
    return this.save();
  }

  /** Follow `prefers-color-scheme`; optionally with other light/dark schemes. */
  followSystem(pair: { light?: string; dark?: string } = {}): Promise<void> {
    this.selection.update((s) => ({
      ...s,
      mode: 'system',
      light: pair.light && this.find(pair.light) ? pair.light : s.light,
      dark: pair.dark && this.find(pair.dark) ? pair.dark : s.dark,
    }));
    return this.save();
  }

  /** The next scheme in the list (fixed), wrapping around. */
  next(): Promise<void> {
    const list = this.themes();
    const i = list.findIndex((t) => t.id === this.active().id);
    return this.select(list[(i + 1) % list.length].id);
  }

  /**
   * Saves an own scheme: `id` of an own scheme = replace it, otherwise a new one
   * (unique name/id). Stores only what differs from the built-in scheme of the
   * same brightness, so corrections of the base arrive (review 013 #11).
   * Selects it unless `select` is false; resolves with its id.
   */
  async saveTheme(draft: ThemeDraft, id?: string, select = true): Promise<string> {
    const own = id ? this.userThemes().find((t) => t.id === id) : undefined;
    const others = this.themes().filter((t) => t.id !== own?.id);
    const name = uniqueName(
      draft.name,
      others.map((t) => t.name),
    );
    const themeId = own?.id ?? newThemeId(name, new Set(this.themes().map((t) => t.id)));
    const base = (draft.dark ? DARK : LIGHT).tokens;
    const tokens = diffTokens(sanitizeTokens(draft.tokens).tokens, base);
    const theme: Theme = { id: themeId, name, dark: draft.dark, tokens };
    this.userThemes.update((list) =>
      own ? list.map((t) => (t.id === own.id ? theme : t)) : [...list, theme],
    );
    if (select) {
      this.selection.update((s) => ({ ...s, mode: 'fixed', theme: themeId }));
    }
    await this.save();
    return themeId;
  }

  /** Removes an own scheme; a selection pointing to it falls back to the built-in ones. */
  deleteTheme(id: string): Promise<void> {
    if (!this.userThemes().some((t) => t.id === id)) {
      return Promise.resolve();
    }
    this.userThemes.update((list) => list.filter((t) => t.id !== id));
    this.selection.update((s) => ({
      mode: s.mode === 'fixed' && s.theme === id ? 'system' : s.mode,
      theme: s.theme === id ? LIGHT.id : s.theme,
      light: s.light === id ? LIGHT.id : s.light,
      dark: s.dark === id ? DARK.id : s.dark,
    }));
    return this.save();
  }

  /**
   * Imports a scheme file as an own scheme; selects it only when it passes the
   * contrast check (review 013 #2). Resolves with what was read.
   */
  async importFile(path: string): Promise<ImportedScheme> {
    const raw = await this.api.importFile(path);
    const imported = normalizeImport(raw);
    if (typeof imported === 'string') {
      throw toFsError({ code: 'invalid_path', message: imported, path });
    }
    const problems = checkContrast(completeTokens(imported, LIGHT, DARK)).filter((r) => !r.ok);
    const selected = problems.length === 0;
    const id = await this.saveTheme(imported, undefined, selected);
    return { ...imported, id, name: this.find(id)?.name ?? imported.name, problems, selected };
  }

  /** Writes a scheme (complete tokens) as `<name>.theme.json` into `dir`; resolves with the path. */
  exportTheme(dir: string, theme: ThemeDraft): Promise<string> {
    const content: ThemeFileContent = {
      name: theme.name,
      dark: theme.dark,
      tokens: completeTokens(theme, LIGHT, DARK),
    };
    return this.api.exportFile(dir, theme.name, content);
  }

  private save(): Promise<void> {
    const file: ThemesFile = {
      version: 1,
      selection: this.selection(),
      themes: this.userThemes().map(({ id, name, dark, tokens }) => ({ id, name, dark, tokens })),
    };
    // one write after the other: the last state wins on disk
    this.saving = this.saving.then(async () => {
      if (!this.persist) {
        return;
      }
      try {
        await this.api.save(file);
      } catch (err) {
        const e = toFsError(err);
        if (e.code === 'no_backend') {
          this.persist = false;
          return;
        }
        this.actions.report(`The colour schemes could not be saved: ${e.message}`);
      }
    });
    return this.saving;
  }

  private apply(theme: ThemeDraft): void {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const applied = new Set<string>();
    const base = (theme.dark ? DARK : LIGHT).tokens;
    for (const [name, raw] of Object.entries(theme.tokens)) {
      // catalog tokens with a value of their kind only, never layout variables (review 013 #1);
      // a bad value falls back to the built-in one
      const value = applicableToken(name, raw) ? raw : base[name];
      if (value !== undefined && applicableToken(name, value)) {
        root.style.setProperty(name, value.trim());
        applied.add(name);
      }
    }
    for (const name of this.appliedNames) {
      if (!applied.has(name)) {
        root.style.removeProperty(name);
      }
    }
    this.appliedNames = applied;
    root.dataset['theme'] = theme.dark ? 'dark' : 'light';
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    const bg = resolveColor('--color-bg', theme.tokens);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = bg ? toHex(bg) : theme.dark ? '#000000' : '#ffffff';
  }
}
