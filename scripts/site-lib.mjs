// Helpers of the landing page and the README pictures (prompt 044) – tests: scripts/site.test.mjs.

/** The folder every picture of site/index.html lives in (next to the page, `pnpm site`). */
export const IMG_BASE = 'img/';

/** All `src` of `<img>` in a HTML text. */
export function imgSources(html) {
  return [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)].map((m) => m[1]);
}

/** File names of the pictures in img/ that the page uses (each once, in order). */
export function siteImages(html) {
  const names = imgSources(html)
    .filter((src) => src.startsWith(IMG_BASE))
    .map((src) => src.slice(IMG_BASE.length));
  return [...new Set(names)];
}

/** Picture paths of a Markdown text: `![alt](path)` and `<img src="path">`. */
export function markdownImages(md) {
  // alt texts may contain [brackets] (multi rename macros)
  const md1 = [...md.matchAll(/!\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  return [...md1, ...imgSources(md)];
}

/** GitHub-style anchor of a heading: lower case, punctuation removed, spaces → "-". */
export function anchorOf(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}
