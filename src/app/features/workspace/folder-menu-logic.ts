import { MenuItem } from './context-menu';

/** A section of the folder menu: its heading (screen readers only) and its entries. */
export interface FolderGroup {
  readonly key: string;
  readonly heading: string | null;
  readonly items: readonly MenuItem[];
}

/** Labels up to this length are shown whole (cut at the end when the column is narrower). */
const WHOLE_UNTIL = 32;
/** So many characters of a long label always stay visible at its end (the folder's name). */
const TAIL = 24;

/** The words of the filter text, lower case; an entry must contain every one of them. */
export function filterTerms(filter: string): string[] {
  return filter.toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesFilter(label: string, terms: readonly string[]): boolean {
  const l = label.toLocaleLowerCase();
  return terms.every((t) => l.includes(t));
}

/**
 * The flat item list (headings start a section) as two columns of sections: everything from the
 * heading `breakId` on goes to the right. With a filter only matching, enabled entries stay – the
 * placeholders "(none)"/"reading drives…" say nothing about a search – and sections without an
 * entry disappear.
 */
export function folderColumns(
  items: readonly MenuItem[],
  breakId: string,
  filter: string,
): [FolderGroup[], FolderGroup[]] {
  const terms = filterTerms(filter);
  const left: { key: string; heading: string | null; items: MenuItem[] }[] = [];
  const right: typeof left = [];
  let column = left;
  for (const item of items) {
    if (item.id === breakId) {
      column = right;
    }
    if (item.heading) {
      column.push({ key: item.id, heading: item.label, items: [] });
    } else if (!item.separator) {
      if (column.length === 0) {
        column.push({ key: `top-${column === left ? 0 : 1}`, heading: null, items: [] });
      }
      if (terms.length === 0 || (!item.disabled && matchesFilter(item.label, terms))) {
        column[column.length - 1].items.push(item);
      }
    }
  }
  const filled = (groups: typeof left) => groups.filter((g) => g.items.length > 0);
  return [filled(left), filled(right)];
}

/**
 * A label in two parts for an ellipsis in the middle: the head shrinks, the tail (the end of a
 * path, which tells folders apart) stays. Cut by characters as shown, never inside one – paths
 * are opaque, this is display only.
 */
export function splitLabel(label: string): { head: string; tail: string } {
  // runs of blanks as one, as HTML shows them (the parts keep their blanks: `white-space: pre`)
  const shown = label.replace(/\s+/g, ' ');
  const chars = graphemes(shown);
  if (chars.length <= WHOLE_UNTIL) {
    return { head: shown, tail: '' };
  }
  return { head: chars.slice(0, -TAIL).join(''), tail: chars.slice(-TAIL).join('') };
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
      (s) => s.segment,
    );
  }
  return Array.from(text);
}
