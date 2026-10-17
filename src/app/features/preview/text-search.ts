/**
 * Pure helpers of the text viewer (design 010 E8): lines, search matches and
 * the segments of a line with highlighted matches. Rendering uses textContent
 * only – never innerHTML.
 */

export interface Match {
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

export interface Segment {
  readonly text: string;
  readonly mark: 'none' | 'hit' | 'current';
}

/** Most matches collected (the count says "10000+"). */
export const MAX_MATCHES = 10_000;

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive matches of `query` (Unicode-aware; indices are UTF-16 offsets). */
export function findMatches(lines: readonly string[], query: string, max = MAX_MATCHES): Match[] {
  if (query === '') {
    return [];
  }
  const re = new RegExp(escapeRegExp(query), 'giu');
  const out: Match[] = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    re.lastIndex = 0;
    for (const m of lines[i].matchAll(re)) {
      out.push({ line: i, start: m.index, end: m.index + m[0].length });
      if (out.length >= max) {
        break;
      }
    }
  }
  return out;
}

/** Next/previous match index, wrapping around; -1 without matches. */
export function stepMatch(current: number, count: number, delta: 1 | -1): number {
  if (count === 0) {
    return -1;
  }
  if (current < 0) {
    return delta === 1 ? 0 : count - 1;
  }
  return (current + delta + count) % count;
}

/** A line split into plain and highlighted parts (`matches` all lie on this line). */
export function segmentsOf(
  line: string,
  matches: readonly Match[],
  current: Match | null,
): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) {
      out.push({ text: line.slice(pos, m.start), mark: 'none' });
    }
    out.push({ text: line.slice(m.start, m.end), mark: m === current ? 'current' : 'hit' });
    pos = m.end;
  }
  if (pos < line.length || out.length === 0) {
    out.push({ text: line.slice(pos), mark: 'none' });
  }
  return out;
}
