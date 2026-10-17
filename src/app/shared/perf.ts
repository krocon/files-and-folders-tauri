/**
 * Tiny timing helper for performance checks (prompt 001: 100 000 entries).
 * Results go to `console.debug` with the prefix `[fnf:perf]` and are kept in
 * {@link perfEntries} (last 50) for inspection in the dev tools.
 */
export interface PerfEntry {
  readonly label: string;
  readonly ms: number;
  readonly detail?: string;
}

export const perfEntries: PerfEntry[] = [];

export function recordPerf(label: string, ms: number, detail?: string): void {
  const entry: PerfEntry = { label, ms: Math.round(ms * 10) / 10, detail };
  perfEntries.push(entry);
  if (perfEntries.length > 50) {
    perfEntries.shift();
  }
  console.debug('[fnf:perf]', entry.label, `${entry.ms} ms`, detail ?? '');
}

/** Milliseconds since `start` (from `performance.now()`). */
export function since(start: number): number {
  return performance.now() - start;
}
