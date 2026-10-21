import { effect, untracked, WritableSignal } from '@angular/core';

/** How long a notice stays before it goes by itself (Marc, 21.10.2026). */
export const NOTICE_MS = 60_000;

/**
 * Removes every text of `list` `ms` after it appeared – unless the user dismissed it
 * before. The same text reported again later starts its own time. Call in an
 * injection context (a constructor).
 */
export function expireNotices(list: WritableSignal<readonly string[]>, ms = NOTICE_MS): void {
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
            setTimeout(() => {
              timers.delete(text);
              list.update((m) => m.filter((t) => t !== text));
            }, ms),
          );
        }
      }
    });
  });
}
