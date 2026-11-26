/**
 * The text typed into the path field ends with a path separator: the user means a
 * folder, so nothing is opened (design 079 E2). This looks at the raw input only –
 * paths from the backend stay opaque.
 */
export function endsWithSeparator(raw: string): boolean {
  return /[\\/]\s*$/.test(raw);
}
