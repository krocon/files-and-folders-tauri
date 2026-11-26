import { effect, untracked, WritableSignal } from '@angular/core';

/**
 * How long a notice stays before it goes by itself: long enough to read it, so a longer
 * text (an error with its reason) stays longer. Marc, 26.11.2026: a minute (21.10.2026)
 * felt like "they never go".
 */
export const NOTICE_MIN_MS = 6_000;
export const NOTICE_MAX_MS = 20_000;
const NOTICE_BASE_MS = 4_000;
const NOTICE_MS_PER_CHAR = 70;

export function noticeMs(text: string): number {
  const wanted = NOTICE_BASE_MS + [...text].length * NOTICE_MS_PER_CHAR;
  return Math.min(NOTICE_MAX_MS, Math.max(NOTICE_MIN_MS, wanted));
}

/**
 * Removes every text of `list` after its time (`noticeMs`, or the fixed `ms`) – unless
 * the user dismissed it before. The same text reported again later starts its own time.
 * Call in an injection context (a constructor).
 */
export function expireNotices(list: WritableSignal<readonly string[]>, ms?: number): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  effect(() => {
    const now = list();
    untracked(() => {
      for (const [text, timer] of timers) {
        if (!now.includes(text)) {
          clearTimeout(timer);
          timers.delete(text);
        }
      }
      for (const text of now) {
        if (!timers.has(text)) {
          timers.set(
            text,
            setTimeout(
              () => {
                timers.delete(text);
                list.update((m) => m.filter((t) => t !== text));
              },
              ms ?? noticeMs(text),
            ),
          );
        }
      }
    });
  });
}
