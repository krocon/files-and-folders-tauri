import { SelectIfRule } from './select-if-engine';

export type SelectIfPresetId =
  | 'moviesWithCover'
  | 'moviesWithoutCover'
  | 'moviesWithSubtitles'
  | 'orphanedImages'
  | 'rawWithoutJpeg'
  | 'missingInOtherPanel'
  | 'emptyFiles';

export interface SelectIfPreset {
  readonly id: SelectIfPresetId;
  readonly rule: SelectIfRule;
}

/**
 * Built-in quick presets for "Select if…" (design 046 E6).
 * Labels come from `SI_TEXTS.presets[id]` so switching language updates them live.
 */
export const SELECT_IF_PRESETS: readonly SelectIfPreset[] = [
  {
    id: 'moviesWithCover',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'category', category: 'movies' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'exists',
          partnerKind: 'files',
          partnerMatcher: { kind: 'category', category: 'images' },
          stemMatch: 'exact',
          includeCompanions: true,
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'moviesWithoutCover',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'category', category: 'movies' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'missing',
          partnerKind: 'files',
          partnerMatcher: { kind: 'category', category: 'images' },
          stemMatch: 'exact',
          includeCompanions: false,
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'moviesWithSubtitles',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'category', category: 'movies' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'exists',
          partnerKind: 'files',
          partnerMatcher: { kind: 'glob', pattern: '*.srt *.sub *.idx *.ass *.ssa *.vtt' },
          stemMatch: 'prefix',
          includeCompanions: true,
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'orphanedImages',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'category', category: 'images' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'missing',
          partnerKind: 'files',
          partnerMatcher: { kind: 'category', category: 'movies' },
          stemMatch: 'exact',
          includeCompanions: false,
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'rawWithoutJpeg',
    rule: {
      targetKind: 'files',
      targetMatcher: {
        kind: 'glob',
        pattern: '*.arw *.cr2 *.cr3 *.nef *.dng *.raf *.orf *.rw2',
      },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'missing',
          partnerKind: 'files',
          partnerMatcher: { kind: 'glob', pattern: '*.jpg *.jpeg' },
          stemMatch: 'exact',
          includeCompanions: false,
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'missingInOtherPanel',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'any' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'otherPanel',
          operator: 'missing',
          compare: 'sameName',
        },
      ],
      combineMode: 'replace',
    },
  },
  {
    id: 'emptyFiles',
    rule: {
      targetKind: 'files',
      targetMatcher: { kind: 'any' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'size',
          operator: 'empty',
          min: '',
          max: '',
          unit: 'B',
        },
      ],
      combineMode: 'replace',
    },
  },
];
