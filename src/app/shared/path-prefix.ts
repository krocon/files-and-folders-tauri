/**
 * `path` is `ancestor` or lies below it. Paths stay opaque (CLAUDE.md §4): only a
 * prefix comparison up to a separator, never split or joined.
 */
export function isSameOrBelow(path: string, ancestor: string): boolean {
  if (path === ancestor) {
    return true;
  }
  if (!path.startsWith(ancestor)) {
    return false;
  }
  // a root like `/` or `C:\` already ends with its separator
  const sep = /[/\\]$/.test(ancestor) ? '' : path.charAt(ancestor.length);
  return sep === '' ? path.length > ancestor.length : sep === '/' || sep === '\\';
}
