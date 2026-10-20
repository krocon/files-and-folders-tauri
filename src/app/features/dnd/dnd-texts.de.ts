import type { Translation } from '../../core/i18n/i18n';
import type { DND_EN } from './dnd-logic';

/** Deutsche Texte von Drag & Drop (design 015). */
export const DND_DE: Translation<typeof DND_EN> = {
  copy: 'Kopieren',
  move: 'Verschieben',
  what: (count, first) => (count === 1 ? first : `${count} Einträge`),
  label: (kind, count, first, target) =>
    `${kind === 'link' ? 'Verknüpfung zu ' : ''}${count === 1 ? first : `${count} Einträge${kind === 'link' ? 'n' : ''}`}${kind === 'copy' ? ' kopieren' : kind === 'move' ? ' verschieben' : ' anlegen'}` +
    (target ? ` → ${target.name}` : ' – hier kein Ziel'),
  hint: (isMac) =>
    `${isMac ? '⌘: verschieben · ⌘⌥: verknüpfen' : 'Umschalt: verschieben · Strg+Umschalt: verknüpfen'} · Esc: abbrechen · aus dem Fenster: andere Programme`,
  notFromArchive:
    'Einträge in einem Archiv lassen sich nicht in andere Programme ziehen – zuerst entpacken.',
  dropFromSystem: (count) => `${count === 1 ? '1 Element' : `${count} Elemente`} hierher kopieren`,
  nothingDropped: 'Die abgelegten Elemente existieren nicht (mehr).',
  missingDropped: (n) => `${n} abgelegte(s) Element(e) existieren nicht und wurden ausgelassen.`,
};
