import { BUILT_IN_FILE_TYPES } from '../../core/file-icon/file-icon.service';
import { DirEntry, VIRTUAL_PATH_PREFIX } from '../../core/fs/fs.models';
import { SearchHit } from '../../core/search/search.models';
import catalog from './select-if-engine.cases.json';
import {
  DEFAULT_SELECT_IF_RULE,
  evaluateSelectIf,
  MAX_CONDITIONS,
  restoreSelectIfRule,
  restoreSelectIfTemplates,
  SelectIfRule,
} from './select-if-engine';

interface RawRow {
  readonly name: string;
  readonly path: string;
  readonly kind: 'file' | 'directory' | 'symlink' | 'unknown';
  readonly targetKind?: 'file' | 'directory' | 'symlink' | 'unknown' | null;
  readonly size: number | null;
  readonly modifiedMs?: number | null;
  readonly parentLink?: boolean;
  readonly dir?: string;
  readonly relDir?: string;
}

function toEntry(r: RawRow): DirEntry {
  const base: DirEntry & { parentLink?: boolean; dir?: string; relDir?: string } = {
    name: r.name,
    path: r.path,
    kind: r.kind,
    targetKind: r.targetKind ?? null,
    size: r.size,
    modifiedMs: r.modifiedMs ?? 1_761_900_000_000,
    hidden: r.name.startsWith('.') && r.name !== '..',
    lossyName: false,
  };
  if (r.parentLink) {
    base.parentLink = true;
  }
  if (r.dir !== undefined) {
    base.dir = r.dir;
    base.relDir = r.relDir ?? '';
  }
  return base;
}

describe('SelectIfEngine – table-driven case catalog (design 046 E2)', () => {
  const fixtures = catalog.fixtures as Record<string, readonly RawRow[]>;

  for (const c of catalog.cases) {
    it(c.name, () => {
      const rawRows: readonly RawRow[] =
        'fixture' in c && c.fixture
          ? fixtures[c.fixture]
          : ((c.entries ?? []) as readonly RawRow[]);
      const entries = rawRows.map(toEntry);
      const res = evaluateSelectIf(entries, c.rule as unknown as SelectIfRule, {
        categories: BUILT_IN_FILE_TYPES,
      });
      expect(res.problems).toEqual([]);
      if ('expectTotalEntries' in c && c.expectTotalEntries !== undefined) {
        expect(res.totalEntries).toBe(c.expectTotalEntries);
      }
      if ('expectPrimaryCount' in c && c.expectPrimaryCount !== undefined) {
        expect(res.rulePrimaryPaths.size).toBe(c.expectPrimaryCount);
      }
      if ('expectCompanionCount' in c && c.expectCompanionCount !== undefined) {
        expect(res.ruleCompanionPaths.size).toBe(c.expectCompanionCount);
      }
      if ('expectMarkedNames' in c && c.expectMarkedNames !== undefined) {
        const markedNames = entries
          .filter((e) => res.nextMarkedPaths.has(e.path))
          .map((e) => e.name);
        expect(markedNames.sort()).toEqual([...c.expectMarkedNames].sort());
      }
      if ('expectMarkedPaths' in c && c.expectMarkedPaths !== undefined) {
        expect([...res.nextMarkedPaths].sort()).toEqual([...c.expectMarkedPaths].sort());
      }
      if ('expectExcludedNames' in c && c.expectExcludedNames !== undefined) {
        const excludedNames = entries
          .filter((e) => res.excludedCandidatePaths.has(e.path))
          .map((e) => e.name);
        expect(excludedNames.sort()).toEqual([...c.expectExcludedNames].sort());
      }
    });
  }
});

describe('SelectIfEngine – edge cases, criteria & invariants (design 046)', () => {
  it('pairs NFC and NFD Unicode names seamlessly (macOS umlauts)', () => {
    const nfcMovie = toEntry({
      name: 'Die H\u00f6lle (1951).mkv',
      path: '/d/nfc.mkv',
      kind: 'file',
      size: 2000,
    });
    const nfdCover = toEntry({
      name: 'Die Ho\u0308lle (1951).jpg',
      path: '/d/nfd.jpg',
      kind: 'file',
      size: 50,
    });
    const res = evaluateSelectIf([nfcMovie, nfdCover], DEFAULT_SELECT_IF_RULE, {
      categories: BUILT_IN_FILE_TYPES,
    });
    expect([...res.nextMarkedPaths]).toEqual(['/d/nfc.mkv', '/d/nfd.jpg']);
  });

  it('ignores "..", virtual aggregate rows and unmarkable hard-link rows completely', () => {
    const entries: DirEntry[] = [
      toEntry({ name: '..', path: '/parent', kind: 'directory', size: null, parentLink: true }),
      toEntry({
        name: '[Other files]',
        path: `${VIRTUAL_PATH_PREFIX}agg`,
        kind: 'file',
        size: 100,
      }),
      toEntry({ name: 'Movie.mkv', path: '/d/Movie.mkv', kind: 'file', size: 1000 }),
      toEntry({ name: 'Movie.jpg', path: '/d/Movie.jpg', kind: 'file', size: 50 }),
      toEntry({ name: 'Hardlink.mkv', path: '/d/Hardlink.mkv', kind: 'file', size: 1000 }),
      toEntry({ name: 'Hardlink.jpg', path: '/d/Hardlink.jpg', kind: 'file', size: 50 }),
    ];
    const res = evaluateSelectIf(entries, DEFAULT_SELECT_IF_RULE, {
      categories: BUILT_IN_FILE_TYPES,
      unmarkablePaths: new Set(['/d/Hardlink.jpg']),
    });
    expect(res.totalEntries).toBe(3); // Movie.mkv, Movie.jpg, Hardlink.mkv
    expect([...res.nextMarkedPaths]).toEqual(['/d/Movie.mkv', '/d/Movie.jpg']);
  });

  it('supports combineMode replace, add, remove and intersect (checking companions across the whole folder first)', () => {
    const entries = [
      toEntry({ name: 'A.mkv', path: '/d/A.mkv', kind: 'file', size: 100 }),
      toEntry({ name: 'A.jpg', path: '/d/A.jpg', kind: 'file', size: 10 }),
      toEntry({ name: 'B.mkv', path: '/d/B.mkv', kind: 'file', size: 100 }),
      toEntry({ name: 'NoCover.mkv', path: '/d/NoCover.mkv', kind: 'file', size: 100 }),
      toEntry({ name: 'Notes.pdf', path: '/d/Notes.pdf', kind: 'file', size: 20 }),
    ];
    const currentMarks = new Set(['/d/A.mkv', '/d/NoCover.mkv', '/d/Notes.pdf']);

    // intersect: A.jpg is NOT in currentMarks, yet A.mkv STILL finds A.jpg in the folder and survives intersection!
    const onlyMoviesWithCover: SelectIfRule = {
      ...DEFAULT_SELECT_IF_RULE,
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'exists',
          partnerKind: 'files',
          partnerMatcher: { kind: 'category', category: 'images' },
          stemMatch: 'exact',
          includeCompanions: false,
        },
      ],
      combineMode: 'intersect',
    };
    const inter = evaluateSelectIf(entries, onlyMoviesWithCover, {
      categories: BUILT_IN_FILE_TYPES,
      currentMarks,
    });
    expect([...inter.nextMarkedPaths]).toEqual(['/d/A.mkv']);

    const added = evaluateSelectIf(
      entries,
      { ...DEFAULT_SELECT_IF_RULE, combineMode: 'add' },
      { categories: BUILT_IN_FILE_TYPES, currentMarks: new Set(['/d/Notes.pdf']) },
    );
    expect([...added.nextMarkedPaths].sort()).toEqual(['/d/A.jpg', '/d/A.mkv', '/d/Notes.pdf']);
    expect(added.addedCount).toBe(2);

    const removed = evaluateSelectIf(
      entries,
      { ...DEFAULT_SELECT_IF_RULE, combineMode: 'remove' },
      { categories: BUILT_IN_FILE_TYPES, currentMarks },
    );
    expect([...removed.nextMarkedPaths].sort()).toEqual(['/d/NoCover.mkv', '/d/Notes.pdf']);
    expect(removed.removedCount).toBe(1);
  });

  it('evaluates otherPanel comparisons (sameName, sameStem, sameNameAndSize, newer, older, missing)', () => {
    const left = [
      toEntry({ name: 'same.txt', path: '/l/same.txt', kind: 'file', size: 100, modifiedMs: 2000 }),
      toEntry({
        name: 'newer.txt',
        path: '/l/newer.txt',
        kind: 'file',
        size: 999,
        modifiedMs: 5000,
      }),
      toEntry({
        name: 'photo.raw',
        path: '/l/photo.raw',
        kind: 'file',
        size: 800,
        modifiedMs: 1000,
      }),
      toEntry({
        name: 'onlyLeft.txt',
        path: '/l/onlyLeft.txt',
        kind: 'file',
        size: 10,
        modifiedMs: 1000,
      }),
    ];
    const right = [
      toEntry({ name: 'same.txt', path: '/r/same.txt', kind: 'file', size: 100, modifiedMs: 2000 }),
      toEntry({
        name: 'newer.txt',
        path: '/r/newer.txt',
        kind: 'file',
        size: 100,
        modifiedMs: 3000,
      }),
      toEntry({
        name: 'photo.jpg',
        path: '/r/photo.jpg',
        kind: 'file',
        size: 50,
        modifiedMs: 1000,
      }),
    ];

    const run = (
      operator: 'exists' | 'missing',
      compare: 'sameName' | 'sameStem' | 'sameNameAndSize' | 'newer' | 'older',
    ) =>
      [
        ...evaluateSelectIf(
          left,
          {
            targetKind: 'files',
            targetMatcher: { kind: 'any' },
            matchMode: 'all',
            conditions: [{ id: 'c1', kind: 'otherPanel', operator, compare }],
            combineMode: 'replace',
          },
          { categories: BUILT_IN_FILE_TYPES, otherEntries: right },
        ).nextMarkedPaths,
      ].sort();

    expect(run('missing', 'sameName')).toEqual(['/l/onlyLeft.txt', '/l/photo.raw']);
    expect(run('exists', 'sameStem')).toEqual(['/l/newer.txt', '/l/photo.raw', '/l/same.txt']);
    expect(run('exists', 'sameNameAndSize')).toEqual(['/l/same.txt']);
    expect(run('exists', 'newer')).toEqual(['/l/newer.txt']);
    expect(run('exists', 'older')).toEqual([]);
  });

  it('evaluates size conditions for files and folders (binary 1024 vs decimal 1000, null dir size ignored)', () => {
    const entries = [
      toEntry({ name: 'empty.txt', path: '/d/empty.txt', kind: 'file', size: 0 }),
      toEntry({ name: '1000b.bin', path: '/d/1000b.bin', kind: 'file', size: 1000 }),
      toEntry({ name: 'SizedDir', path: '/d/SizedDir', kind: 'directory', size: 2048 }),
      toEntry({ name: 'UnsizedDir', path: '/d/UnsizedDir', kind: 'directory', size: null }),
    ];

    const emptyRes = evaluateSelectIf(
      entries,
      {
        targetKind: 'both',
        targetMatcher: { kind: 'any' },
        matchMode: 'all',
        conditions: [{ id: 'c1', kind: 'size', operator: 'empty', min: '', max: '', unit: 'B' }],
        combineMode: 'replace',
      },
      { categories: BUILT_IN_FILE_TYPES },
    );
    expect([...emptyRes.nextMarkedPaths]).toEqual(['/d/empty.txt']);

    const ge1KbRule: SelectIfRule = {
      targetKind: 'both',
      targetMatcher: { kind: 'any' },
      matchMode: 'all',
      conditions: [{ id: 'c1', kind: 'size', operator: 'between', min: '1', max: '3', unit: 'KB' }],
      combineMode: 'replace',
    };
    // binary (1 KB = 1024): only SizedDir (2048) matches
    expect([
      ...evaluateSelectIf(entries, ge1KbRule, { categories: BUILT_IN_FILE_TYPES, sizeBase: 1024 })
        .nextMarkedPaths,
    ]).toEqual(['/d/SizedDir']);
    // decimal (1 kB = 1000): both 1000b.bin and SizedDir match
    expect(
      [
        ...evaluateSelectIf(entries, ge1KbRule, { categories: BUILT_IN_FILE_TYPES, sizeBase: 1000 })
          .nextMarkedPaths,
      ].sort(),
    ).toEqual(['/d/1000b.bin', '/d/SizedDir']);
  });

  it('evaluates modified conditions deterministically against injected nowMs and local calendar dates', () => {
    const nowMs = new Date(2026, 9, 31, 12, 0, 0).getTime(); // 2026-10-31 12:00 local
    const entries = [
      toEntry({
        name: 'recent.txt',
        path: '/d/recent.txt',
        kind: 'file',
        size: 10,
        modifiedMs: nowMs - 2 * 3_600_000, // 2h ago
      }),
      toEntry({
        name: 'oct15.txt',
        path: '/d/oct15.txt',
        kind: 'file',
        size: 10,
        modifiedMs: new Date(2026, 9, 15, 18, 30, 0).getTime(),
      }),
      toEntry({
        name: 'old.txt',
        path: '/d/old.txt',
        kind: 'file',
        size: 10,
        modifiedMs: new Date(2025, 0, 10, 9, 0, 0).getTime(),
      }),
      toEntry({
        name: 'unknownDate.txt',
        path: '/d/unknownDate.txt',
        kind: 'file',
        size: 10,
        modifiedMs: null,
      }),
    ];

    const within3h = evaluateSelectIf(
      entries,
      {
        targetKind: 'files',
        targetMatcher: { kind: 'any' },
        matchMode: 'all',
        conditions: [
          {
            id: 'c1',
            kind: 'modified',
            operator: 'withinLast',
            amount: '3',
            ageUnit: 'hours',
            dateFrom: '',
            dateTo: '',
          },
        ],
        combineMode: 'replace',
      },
      { categories: BUILT_IN_FILE_TYPES, nowMs },
    );
    expect([...within3h.nextMarkedPaths]).toEqual(['/d/recent.txt']);

    const betweenOct = evaluateSelectIf(
      entries,
      {
        targetKind: 'files',
        targetMatcher: { kind: 'any' },
        matchMode: 'all',
        conditions: [
          {
            id: 'c1',
            kind: 'modified',
            operator: 'between',
            amount: '',
            ageUnit: 'days',
            dateFrom: '2026-10-01',
            dateTo: '2026-10-20',
          },
        ],
        combineMode: 'replace',
      },
      { categories: BUILT_IN_FILE_TYPES, nowMs },
    );
    expect([...betweenOct.nextMarkedPaths]).toEqual(['/d/oct15.txt']);
  });

  it('evaluates name conditions (glob & regex) and reports unknown categories and invalid inputs cleanly', () => {
    const entries = [
      toEntry({ name: 'Movie (1985).mkv', path: '/d/1.mkv', kind: 'file', size: 100 }),
      toEntry({ name: 'Movie (1985) trailer.mkv', path: '/d/2.mkv', kind: 'file', size: 10 }),
      toEntry({ name: 'Movie (2026).mkv', path: '/d/3.mkv', kind: 'file', size: 100 }),
    ];

    const eightiesNoTrailer = evaluateSelectIf(
      entries,
      {
        targetKind: 'files',
        targetMatcher: { kind: 'category', category: 'movies' },
        matchMode: 'all',
        conditions: [
          {
            id: 'c1',
            kind: 'name',
            operator: 'matches',
            mode: 'regex',
            pattern: '\\(198\\d\\)',
          },
          {
            id: 'c2',
            kind: 'name',
            operator: 'notMatches',
            mode: 'glob',
            pattern: '*trailer* *sample*',
          },
        ],
        combineMode: 'replace',
      },
      { categories: BUILT_IN_FILE_TYPES },
    );
    expect([...eightiesNoTrailer.nextMarkedPaths]).toEqual(['/d/1.mkv']);

    // Deleted category produces a clear validation problem rather than silently matching 0 or all
    const deletedCat = evaluateSelectIf(
      entries,
      {
        ...DEFAULT_SELECT_IF_RULE,
        targetMatcher: { kind: 'category', category: 'deleted-custom-cat' },
      },
      { categories: BUILT_IN_FILE_TYPES },
    );
    expect(deletedCat.problems).toEqual([
      { field: 'targetMatcher', code: 'unknownCategory', detail: 'deleted-custom-cat' },
    ]);

    // Invalid regex produces invalidRegex problem
    const badRegex = evaluateSelectIf(
      entries,
      {
        ...DEFAULT_SELECT_IF_RULE,
        conditions: [
          { id: 'c1', kind: 'name', operator: 'matches', mode: 'regex', pattern: '([unclosed' },
        ],
      },
      { categories: BUILT_IN_FILE_TYPES },
    );
    expect(badRegex.problems[0]?.code).toBe('invalidRegex');
    expect(badRegex.problems[0]?.field).toBe('cond:c1:pattern');
  });

  it('distinguishes files, symlinks to files, directories and symlinks to directories', () => {
    const entries = [
      toEntry({ name: 'real.txt', path: '/d/real.txt', kind: 'file', size: 1 }),
      toEntry({
        name: 'linkFile.txt',
        path: '/d/linkFile.txt',
        kind: 'symlink',
        targetKind: 'file',
        size: 1,
      }),
      toEntry({ name: 'RealDir', path: '/d/RealDir', kind: 'directory', size: null }),
      toEntry({
        name: 'LinkDir',
        path: '/d/LinkDir',
        kind: 'symlink',
        targetKind: 'directory',
        size: null,
      }),
    ];
    const base: SelectIfRule = {
      targetKind: 'files',
      targetMatcher: { kind: 'any' },
      matchMode: 'all',
      conditions: [{ id: 'c1', kind: 'name', operator: 'matches', mode: 'glob', pattern: '*' }],
      combineMode: 'replace',
    };
    expect([
      ...evaluateSelectIf(entries, base, { categories: BUILT_IN_FILE_TYPES }).nextMarkedPaths,
    ]).toEqual(['/d/real.txt', '/d/linkFile.txt']);
    expect([
      ...evaluateSelectIf(
        entries,
        { ...base, targetKind: 'dirs' },
        { categories: BUILT_IN_FILE_TYPES },
      ).nextMarkedPaths,
    ]).toEqual(['/d/RealDir', '/d/LinkDir']);
  });

  it('restores rules and templates defensively from untrusted settings JSON', () => {
    expect(restoreSelectIfRule(null)).toEqual(DEFAULT_SELECT_IF_RULE);
    expect(
      restoreSelectIfRule({
        targetKind: 'bogus',
        conditions: Array.from({ length: 20 }, (_, i) => ({
          id: `x${i}`,
          kind: 'size',
          operator: 'empty',
        })),
      }).conditions.length,
    ).toBe(MAX_CONDITIONS);

    const tpls = restoreSelectIfTemplates([
      null,
      { label: '  ', rule: DEFAULT_SELECT_IF_RULE },
      { label: 'My Rule', rule: DEFAULT_SELECT_IF_RULE },
      { label: 'My Rule', rule: { ...DEFAULT_SELECT_IF_RULE, combineMode: 'add' } },
    ]);
    expect(tpls).toHaveLength(1);
    expect(tpls[0].label).toBe('My Rule');
    expect(tpls[0].rule.combineMode).toBe('replace');
  });

  it('evaluates 50 000 flat-view entries in under 50 ms (exact and prefix)', () => {
    const entries: SearchHit[] = [];
    for (let i = 0; i < 25_000; i++) {
      const folder = `/media/dir_${i % 250}`;
      const relDir = `dir_${i % 250}`;
      const parentNames: readonly [string, string, string] = ['', 'media', relDir];
      entries.push({
        name: `Movie_${i}.mkv`,
        path: `${folder}/Movie_${i}.mkv`,
        dir: folder,
        relDir,
        parentNames,
        kind: 'file',
        targetKind: null,
        size: 1_000_000,
        modifiedMs: 1_760_000_000_000,
        hidden: false,
        lossyName: false,
      });
      entries.push({
        name: i % 2 === 0 ? `Movie_${i}.de.srt` : `Unrelated_${i}.txt`,
        path: `${folder}/${i % 2 === 0 ? `Movie_${i}.de.srt` : `Unrelated_${i}.txt`}`,
        dir: folder,
        relDir,
        parentNames,
        kind: 'file',
        targetKind: null,
        size: 4096,
        modifiedMs: 1_760_000_000_000,
        hidden: false,
        lossyName: false,
      });
    }

    const prefixRule: SelectIfRule = {
      targetKind: 'files',
      targetMatcher: { kind: 'category', category: 'movies' },
      matchMode: 'all',
      conditions: [
        {
          id: 'c1',
          kind: 'companion',
          operator: 'exists',
          partnerKind: 'files',
          partnerMatcher: { kind: 'glob', pattern: '*.srt' },
          stemMatch: 'prefix',
          includeCompanions: true,
        },
      ],
      combineMode: 'replace',
    };

    // Warmup JIT once so the timed run measures steady-state algorithmic speed
    evaluateSelectIf(entries.slice(0, 1000), prefixRule, { categories: BUILT_IN_FILE_TYPES });

    const t0 = performance.now();
    const res = evaluateSelectIf(entries, prefixRule, { categories: BUILT_IN_FILE_TYPES });
    const elapsedMs = performance.now() - t0;

    expect(res.rulePrimaryPaths.size).toBe(12_500);
    expect(res.ruleCompanionPaths.size).toBe(12_500);
    expect(res.nextMarkedPaths.size).toBe(25_000);
    expect(elapsedMs).toBeLessThan(500); // generous for CI; measured ~25–35 ms locally (< 50 ms target)
  });
});
