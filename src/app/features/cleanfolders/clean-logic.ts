import {
  CleanItem,
  CleanOptions,
  CleanScan,
  DEFAULT_JUNK,
  KeepReason,
  RootVerdict,
} from '../../core/folders/folders.models';
import {
  RELEASE_EXTRAS,
  RELEASE_SAMPLES,
  RELEASE_SUBTITLES,
} from '../../core/folders/release-extras';
import { DirEntry, isParentRow, isVirtualPath } from '../../core/fs/fs.models';
import { boolOr, intOr, oneOf, record, textOr } from '../../shared/restore-fields';
import { formatSize } from '../../shared/format';
import { CL_TEXTS } from './clean-texts';

/** Pure helpers of "clean folders" (design 077): form → options, input, rows, sums. No Angular. */

export type CleanProfile = 'empty' | 'release' | 'custom';
export const CLEAN_PROFILES: readonly CleanProfile[] = ['empty', 'release', 'custom'];

const MIB = 1024 * 1024;
/** Largest limit the form takes (MiB). */
export const MAX_LIMIT_MB = 1_000_000;

/** What the form shows (texts stay when a switch is off). */
export interface CleanForm {
  readonly profile: CleanProfile;
  /** Limit for extras that only a pattern makes extras (MiB). */
  readonly junkMaxMb: number;
  /** Limit for samples (MiB) – profile "release". */
  readonly sampleMaxMb: number;
  /** Extras-only folders next to content go, too (default off). */
  readonly junkDirsBesideContent: boolean;
  // ---- profile "custom" (the form of design 008) ----
  readonly emptyDirs: boolean;
  readonly junkOn: boolean;
  readonly junkText: string;
  readonly patternsOn: boolean;
  readonly patternsText: string;
}

export const DEFAULT_CLEAN_FORM: CleanForm = {
  // a profile that deletes files must have been chosen (design 077 E4)
  profile: 'empty',
  junkMaxMb: 1,
  sampleMaxMb: 300,
  junkDirsBesideContent: false,
  emptyDirs: true,
  junkOn: false,
  junkText: DEFAULT_JUNK.join('; '),
  patternsOn: false,
  patternsText: '*.bak',
};

/** The form kept from the last run (design 027 E5) – never the delete mode (trash every time). */
export function restoreCleanForm(v: unknown): CleanForm {
  const r = record(v);
  const d = DEFAULT_CLEAN_FORM;
  const custom = {
    emptyDirs: boolOr(r['emptyDirs'], d.emptyDirs),
    junkOn: boolOr(r['junkOn'], d.junkOn),
    junkText: textOr(r['junkText'], d.junkText),
    patternsOn: boolOr(r['patternsOn'], d.patternsOn),
    patternsText: textOr(r['patternsText'], d.patternsText),
  };
  // a form kept before design 077 has no profile: what it had switched on was "custom"
  const before077: CleanProfile =
    custom.junkOn || custom.patternsOn || !custom.emptyDirs ? 'custom' : 'empty';
  return {
    profile: oneOf(r['profile'], CLEAN_PROFILES, before077),
    junkMaxMb: intOr(r['junkMaxMb'], d.junkMaxMb, 0, MAX_LIMIT_MB),
    sampleMaxMb: intOr(r['sampleMaxMb'], d.sampleMaxMb, 0, MAX_LIMIT_MB),
    junkDirsBesideContent: boolOr(r['junkDirsBesideContent'], d.junkDirsBesideContent),
    ...custom,
  };
}

function split(text: string): string[] {
  return text
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** The options Rust gets for a form. `includeRoots`: the start folders may go as a whole. */
export function cleanOptions(f: CleanForm, includeRoots: boolean): CleanOptions {
  const limits = {
    junkMaxBytes: f.junkMaxMb * MIB,
    largeJunkMaxBytes: f.sampleMaxMb * MIB,
  };
  switch (f.profile) {
    case 'empty':
      return {
        emptyDirs: true,
        includeRoots,
        junk: [...DEFAULT_JUNK],
        patterns: [],
        largeJunk: [],
        ...limits,
        junkDirsBesideContent: false,
        companionJunk: [],
      };
    case 'release':
      return {
        emptyDirs: true,
        includeRoots,
        junk: [...DEFAULT_JUNK, ...RELEASE_EXTRAS],
        patterns: [],
        largeJunk: [...RELEASE_SAMPLES],
        ...limits,
        junkDirsBesideContent: f.junkDirsBesideContent,
        // subtitles go with a leftover, never on their own or next to content (Rust decides)
        companionJunk: [...RELEASE_SUBTITLES],
      };
    case 'custom':
      return {
        emptyDirs: f.emptyDirs,
        includeRoots: f.emptyDirs && includeRoots,
        junk: f.emptyDirs && f.junkOn ? split(f.junkText) : [],
        patterns: f.patternsOn ? split(f.patternsText) : [],
        largeJunk: [],
        ...limits,
        junkDirsBesideContent: f.emptyDirs && f.junkDirsBesideContent,
        companionJunk: [],
      };
  }
}

/** What the dialog works on (design 077 E5). */
export interface CleanInput {
  readonly roots: readonly string[];
  /** Marked folders and the folder under the cursor may go as a whole – the panel's own folder never. */
  readonly includeRoots: boolean;
  /** Marked entries that are no real folders (files, links): ignored, counted for a hint. */
  readonly ignored: number;
}

const realDir = (e: DirEntry | null | undefined): e is DirEntry =>
  !!e && !isParentRow(e) && !isVirtualPath(e.path) && e.kind === 'directory';

/**
 * Start folders like F8 picks its entries: the marked real folders (not links); without
 * marks the folder under the cursor; otherwise the folder the panel shows.
 */
export function cleanInput(
  folder: string,
  marked: readonly DirEntry[],
  cursor: DirEntry | null,
): CleanInput {
  const real = marked.filter((e) => !isParentRow(e));
  const dirs = real.filter(realDir).map((e) => e.path);
  if (dirs.length > 0) {
    return { roots: dirs, includeRoots: true, ignored: real.length - dirs.length };
  }
  if (real.length === 0 && realDir(cursor)) {
    return { roots: [cursor.path], includeRoots: true, ignored: 0 };
  }
  return { roots: [folder], includeRoots: false, ignored: real.length };
}

/** A verdict that offers something to delete. */
export function selectable(v: RootVerdict): boolean {
  return v.verdict !== 'keep' && v.count > 0;
}

/** The selected start folders: all that offer something, minus what the user took out. */
export function selection(scan: CleanScan | null, deselected: ReadonlySet<string>): Set<string> {
  return new Set(
    (scan?.roots ?? []).filter((r) => selectable(r) && !deselected.has(r.path)).map((r) => r.path),
  );
}

export interface CleanSums {
  readonly roots: number;
  readonly dirs: number;
  readonly files: number;
  readonly bytes: number;
}

export function sums(scan: CleanScan | null, selected: ReadonlySet<string>): CleanSums {
  const out = { roots: 0, dirs: 0, files: 0, bytes: 0 };
  for (const r of scan?.roots ?? []) {
    if (selected.has(r.path)) {
      out.roots += 1;
      out.dirs += r.removeDirs;
      out.files += r.removeFiles;
      out.bytes += r.removeBytes;
    }
  }
  return out;
}

/** What the job gets: the entries of the selected start folders – path and kind only. */
export function jobItems(scan: CleanScan, selected: ReadonlySet<string>): CleanItem[] {
  return scan.roots
    .filter((r) => selected.has(r.path))
    .flatMap((r) => scan.items.slice(r.first, r.first + r.count))
    .map((i) => ({ path: i.path, kind: i.kind }));
}

/** "2 folders · 1 file · 736 B", or "–". */
export function removesText(v: RootVerdict): string {
  return v.count === 0
    ? '–'
    : CL_TEXTS.counts(v.removeDirs, v.removeFiles, formatSize(v.removeBytes));
}

/**
 * Why the folder (or the rest of it) stays: "3 files · 1.97 GB (.cbr)", "sample larger
 * than 300 MiB" … – "–" for a leftover that goes as a whole.
 */
export function keepsText(v: RootVerdict, o: CleanOptions): string {
  if (v.incomplete) {
    return CL_TEXTS.incomplete;
  }
  const parts: string[] = [];
  if (v.sampleTooLarge > 0) {
    parts.push(CL_TEXTS.sampleTooLarge(v.sampleTooLarge, formatSize(o.largeJunkMaxBytes)));
  }
  if (v.tooLarge > 0) {
    parts.push(CL_TEXTS.tooLarge(v.tooLarge, formatSize(o.junkMaxBytes)));
  }
  if (v.keepFiles > 0) {
    const ext = v.keepExtensions.length > 0 ? ` (${v.keepExtensions.join(', ')})` : '';
    parts.push(`${CL_TEXTS.filesSize(v.keepFiles, formatSize(v.keepBytes))}${ext}`);
  }
  if (v.hidden > 0) {
    parts.push(CL_TEXTS.hiddenFiles(v.hidden));
  }
  if (v.links > 0) {
    parts.push(CL_TEXTS.links(v.links));
  }
  if (v.blocked > 0) {
    parts.push(CL_TEXTS.blocked(v.blocked));
  }
  if (v.verdict === 'residue') {
    return parts.length > 0 ? parts.join(' · ') : '–';
  }
  const hasContent = parts.length > 0;
  if (v.junkKept > 0) {
    parts.push(hasContent ? CL_TEXTS.junkKept(v.junkKept) : CL_TEXTS.onlyExtras(v.junkKept));
  }
  if (v.danger !== null) {
    parts.push(CL_TEXTS.danger[v.danger]);
  } else if (v.linked) {
    parts.push(CL_TEXTS.linkedRoot);
  } else if (!hasContent && !o.includeRoots) {
    parts.push(CL_TEXTS.ownFolder);
  }
  return parts.length > 0 ? parts.join(' · ') : CL_TEXTS.empty;
}

/** A row of the folder table. */
export interface RootRow {
  readonly path: string;
  /** ☑ / ☐, "–" for a folder that offers nothing. */
  readonly check: string;
  readonly name: string;
  readonly verdict: string;
  readonly removes: string;
  readonly keeps: string;
  readonly selectable: boolean;
}

export function rootRows(
  scan: CleanScan | null,
  selected: ReadonlySet<string>,
  o: CleanOptions,
): RootRow[] {
  return (scan?.roots ?? []).map((r) => {
    const can = selectable(r);
    return {
      path: r.path,
      check: !can ? '–' : selected.has(r.path) ? '☑' : '☐',
      name: r.name,
      verdict: CL_TEXTS.verdict[r.verdict],
      removes: removesText(r),
      keeps: keepsText(r, o),
      selectable: can,
    };
  });
}

/** Muted rows: nothing to select. */
export function rootRowClass(row: RootRow): string | null {
  return row.selectable ? null : 'fnf-mr-unchanged';
}

function reasonText(reason: KeepReason, o: CleanOptions): string {
  switch (reason) {
    case 'tooLarge':
      return CL_TEXTS.keepReason.tooLarge(formatSize(o.junkMaxBytes));
    case 'sampleTooLarge':
      return CL_TEXTS.keepReason.sampleTooLarge(formatSize(o.largeJunkMaxBytes));
    default:
      return CL_TEXTS.keepReason[reason];
  }
}

/** A row of the details: what goes (children first) and what stays, with the reason. */
export interface DetailRow {
  readonly what: string;
  readonly entry: string;
  readonly size: string;
  readonly info: string;
  readonly stays: boolean;
}

export function detailRows(
  scan: CleanScan | null,
  root: RootVerdict | null,
  o: CleanOptions,
): DetailRow[] {
  if (!scan || !root) {
    return [];
  }
  const rows: DetailRow[] = scan.items.slice(root.first, root.first + root.count).map((it) => {
    const junk = it.junk ?? 0;
    const names = it.junkNames ?? [];
    const info =
      it.kind === 'file'
        ? CL_TEXTS.matchesPattern
        : junk === 0
          ? CL_TEXTS.emptyDir
          : `${CL_TEXTS.junkInside(junk, formatSize(it.bytes ?? 0))}: ${names.join(', ')}${junk > names.length ? ' …' : ''}`;
    return {
      what: CL_TEXTS.goes,
      entry: it.rel ? it.rel : CL_TEXTS.wholeFolder,
      size: it.kind === 'file' ? formatSize(it.bytes ?? 0) : '',
      info,
      stays: false,
    };
  });
  for (const k of root.keepSample) {
    rows.push({
      what: CL_TEXTS.stays,
      entry: k.rel === '' ? CL_TEXTS.wholeFolder : k.rel,
      size: k.bytes > 0 ? formatSize(k.bytes) : '',
      info: reasonText(k.reason, o),
      stays: true,
    });
  }
  const more = root.keepFiles + root.links + root.blocked - root.keepSample.length;
  if (more > 0) {
    rows.push({
      what: CL_TEXTS.stays,
      entry: CL_TEXTS.moreKept(more),
      size: '',
      info: '',
      stays: true,
    });
  }
  return rows;
}

export function detailRowClass(row: DetailRow): string | null {
  return row.stays ? 'fnf-mr-unchanged' : null;
}

/**
 * The form protects less than the defaults do (review 077 #6): a higher size limit, or
 * extras-only folders next to content – as far as the profile uses these values. Kept from
 * an earlier run they would work unseen behind the folded rules.
 */
export function loosened(f: CleanForm): boolean {
  const d = DEFAULT_CLEAN_FORM;
  switch (f.profile) {
    case 'empty':
      return false;
    case 'release':
      return f.junkMaxMb > d.junkMaxMb || f.sampleMaxMb > d.sampleMaxMb || f.junkDirsBesideContent;
    case 'custom':
      return f.emptyDirs && f.junkOn && (f.junkMaxMb > d.junkMaxMb || f.junkDirsBesideContent);
  }
}
