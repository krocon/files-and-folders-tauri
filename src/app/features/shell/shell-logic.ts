/**
 * Pure helpers of the shell bar (design 021): history navigation with a draft,
 * suggestions from the history, the bounded output buffer and the middle
 * ellipsis of the prompt. No paths are split here – the prompt is shortened by
 * characters only.
 */

/** Position in the history: `-1` = the line being typed (the draft). */
export interface HistoryNav {
  readonly index: number;
  readonly draft: string;
}

export const NO_NAV: HistoryNav = { index: -1, draft: '' };

/**
 * ↑ (`-1`, older) / ↓ (`+1`, newer). Returns the new position and the text for
 * the field, or `null` if nothing changes (top of the history, or already at the draft).
 */
export function historyStep(
  history: readonly string[],
  nav: HistoryNav,
  current: string,
  dir: -1 | 1,
): { nav: HistoryNav; text: string } | null {
  if (dir === -1) {
    const next = nav.index + 1;
    if (next >= history.length) {
      return null;
    }
    const draft = nav.index === -1 ? current : nav.draft;
    return { nav: { index: next, draft }, text: history[next] };
  }
  if (nav.index === -1) {
    return null;
  }
  const next = nav.index - 1;
  return {
    nav: { index: next, draft: next === -1 ? '' : nav.draft },
    text: next === -1 ? nav.draft : history[next],
  };
}

export const MAX_SUGGESTIONS = 8;

/** History entries that start with `prefix` (newest first), not the prefix itself. */
export function suggestions(history: readonly string[], prefix: string): string[] {
  if (!prefix.trim()) {
    return [];
  }
  return history.filter((h) => h.startsWith(prefix) && h !== prefix).slice(0, MAX_SUGGESTIONS);
}

/** The newest line first, an older equal one removed (as Rust does), at most 100. */
export function remember(history: readonly string[], line: string, max = 100): string[] {
  return [line, ...history.filter((h) => h !== line)].slice(0, max);
}

/** Shortens in the middle (`/home/ma…/Projekte`), by characters (emoji stay whole). */
export function middleEllipsis(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max || max < 5) {
    return text;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/** Kinds of output text: the prompt line, the program's streams, messages of the app. */
export type SegmentKind = 'prompt' | 'stdout' | 'stderr' | 'info' | 'error';

export interface Segment {
  readonly kind: SegmentKind;
  readonly text: string;
}

export const MAX_LINES = 10_000;
export const MAX_CHARS = 2 * 1024 * 1024;

function lineCount(text: string): number {
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    n++;
  }
  return n;
}

/**
 * The output of the shell bar: segments of one kind are merged; above
 * {@link MAX_LINES} lines or {@link MAX_CHARS} characters the oldest lines go
 * (`trimmed` is then set). Mutable on purpose – the store bumps a version signal.
 */
export class OutputBuffer {
  private items: { kind: SegmentKind; text: string }[] = [];
  private chars = 0;
  private lines = 0;
  trimmed = false;

  constructor(
    private readonly maxLines = MAX_LINES,
    private readonly maxChars = MAX_CHARS,
  ) {}

  get segments(): readonly Segment[] {
    return this.items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** The whole text (for copying). */
  text(): string {
    return this.items.map((s) => s.text).join('');
  }

  /** Whether the text so far ends with a line end (or is empty). */
  atLineStart(): boolean {
    const last = this.items.at(-1);
    return !last || last.text.endsWith('\n');
  }

  append(kind: SegmentKind, text: string): void {
    if (!text) {
      return;
    }
    const last = this.items.at(-1);
    if (last && last.kind === kind) {
      last.text += text;
    } else {
      this.items.push({ kind, text });
    }
    this.chars += text.length;
    this.lines += lineCount(text);
    this.trim();
  }

  /** Starts a line of its own (a prompt or message after unterminated output). */
  appendLine(kind: SegmentKind, text: string): void {
    if (!this.atLineStart()) {
      this.append(kind, '\n');
    }
    this.append(kind, `${text}\n`);
  }

  clear(): void {
    this.items = [];
    this.chars = 0;
    this.lines = 0;
    this.trimmed = false;
  }

  private trim(): void {
    while (this.items.length > 0 && (this.lines > this.maxLines || this.chars > this.maxChars)) {
      this.trimmed = true;
      const first = this.items[0];
      let cut: number;
      if (this.lines > this.maxLines) {
        // the oldest line
        const nl = first.text.indexOf('\n');
        cut = nl === -1 ? first.text.length : nl + 1;
      } else {
        // enough characters – up to a line end where there is one
        const over = this.chars - this.maxChars;
        const nl = first.text.indexOf('\n', over - 1);
        cut = nl === -1 ? Math.min(over, first.text.length) : nl + 1;
        const code = first.text.charCodeAt(cut);
        if (code >= 0xdc00 && code <= 0xdfff) {
          cut++; // not inside a surrogate pair
        }
      }
      const removed = first.text.slice(0, cut);
      this.chars -= removed.length;
      this.lines -= lineCount(removed);
      if (cut >= first.text.length) {
        this.items.shift();
      } else {
        first.text = first.text.slice(cut);
      }
    }
  }
}
