import { Preview } from '../../core/preview/preview.models';
import { PV_TEXTS } from './preview-texts';

/** Notes above a preview: wrong extension, cut at the limit, invalid bytes. */
export function previewNotes(p: Preview | null, name: string): string[] {
  if (!p || p.kind === 'directory' || p.kind === 'other') {
    return [];
  }
  const notes: string[] = [];
  if (p.extMismatch) {
    const dot = name.lastIndexOf('.');
    notes.push(PV_TEXTS.mismatch(p.format.label, dot > 0 ? name.slice(dot + 1) : null));
  }
  if (p.kind === 'text' && p.truncated) {
    notes.push(PV_TEXTS.truncated(new TextEncoder().encode(p.text).length, p.size));
  }
  if (p.kind === 'binary' && p.truncated) {
    notes.push(PV_TEXTS.truncated(p.bytes.length, p.size));
  }
  if (p.kind === 'text' && p.lossy) {
    notes.push(PV_TEXTS.lossy);
  }
  return notes;
}
