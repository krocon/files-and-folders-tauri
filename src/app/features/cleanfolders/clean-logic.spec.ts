import { CleanOptions, RootVerdict } from '../../core/folders/folders.models';
import {
  RELEASE_EXTRAS,
  RELEASE_SAMPLES,
  RELEASE_SUBTITLES,
  VIDEO_EXTENSIONS,
} from '../../core/folders/release-extras';
import { cleanScan, rootVerdict } from '../../../testing/fake-folders-api';
import { dir, entry } from '../../../testing/fs-fixtures';
import {
  cleanInput,
  cleanOptions,
  DEFAULT_CLEAN_FORM,
  detailRows,
  jobItems,
  keepsText,
  loosened,
  removesText,
  restoreCleanForm,
  rootRows,
  selection,
  sums,
} from './clean-logic';

const MIB = 1024 * 1024;
const RELEASE = cleanOptions({ ...DEFAULT_CLEAN_FORM, profile: 'release' }, true);

/** Marc's four folders as Rust answers them (prompt 077, numbers from the Rust test). */
function marcsScan() {
  const mob = '/f/MobLand S02';
  return cleanScan([
    {
      path: '/f/Lustiges Taschenbuch',
      over: {
        keepFiles: 3,
        keepBytes: 1_966_178_334,
        keepExtensions: ['.cbr'],
        keepSample: [{ rel: 'a.cbr', bytes: 765_215_206, reason: 'content' }],
      },
    },
    {
      path: '/f/Mein Land',
      items: [
        {
          path: '/f/Mein Land/Rel',
          kind: 'dir',
          junk: 1,
          junkNames: ['x.nfo'],
          bytes: 736,
          rel: 'Rel',
        },
        { path: '/f/Mein Land', kind: 'dir', rel: '' },
      ],
      over: { verdict: 'residue' },
    },
    {
      path: '/f/Miss Merkel',
      items: [
        { path: '/f/Miss Merkel/Rel', kind: 'dir', junk: 1, bytes: 647, rel: 'Rel' },
        { path: '/f/Miss Merkel', kind: 'dir', rel: '' },
      ],
      over: { verdict: 'residue' },
    },
    {
      path: mob,
      items: [
        { path: `${mob}/E08/Sample`, kind: 'dir', junk: 1, bytes: 57_434_089, rel: 'E08/Sample' },
        { path: `${mob}/E08`, kind: 'dir', junk: 1, bytes: 629, rel: 'E08' },
        { path: `${mob}/E09/Sample`, kind: 'dir', junk: 1, bytes: 78_788_631, rel: 'E09/Sample' },
        { path: `${mob}/E09`, kind: 'dir', junk: 1, bytes: 629, rel: 'E09' },
        { path: `${mob}/E10/Sample`, kind: 'dir', junk: 1, bytes: 75_799_597, rel: 'E10/Sample' },
        { path: `${mob}/E10`, kind: 'dir', junk: 1, bytes: 629, rel: 'E10' },
        { path: mob, kind: 'dir', rel: '' },
      ],
      over: { verdict: 'residue' },
    },
  ]);
}

describe('clean folders: pure helpers (design 077)', () => {
  it('profiles become options – only a chosen profile names files', () => {
    const limits = { junkMaxBytes: MIB, largeJunkMaxBytes: 300 * MIB };
    // the default: nothing but empty folders and system junk
    expect(cleanOptions(DEFAULT_CLEAN_FORM, true)).toEqual({
      emptyDirs: true,
      includeRoots: true,
      junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini'],
      patterns: [],
      largeJunk: [],
      ...limits,
      junkDirsBesideContent: false,
      companionJunk: [],
    });
    // a text in the custom fields never leaks into another profile
    expect(
      cleanOptions(
        { ...DEFAULT_CLEAN_FORM, patternsOn: true, junkOn: true, junkDirsBesideContent: true },
        false,
      ),
    ).toMatchObject({ patterns: [], includeRoots: false, junkDirsBesideContent: false });
    expect(RELEASE).toEqual({
      emptyDirs: true,
      includeRoots: true,
      junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini', ...RELEASE_EXTRAS],
      patterns: [],
      largeJunk: [...RELEASE_SAMPLES],
      ...limits,
      junkDirsBesideContent: false,
      // subtitles: companions of a leftover only (addendum 26.11.2026)
      companionJunk: ['*.idx', '*.sub', '*.srt', '*.ass', '*.ssa', '*.sup', '*.vtt'],
    });
    expect(RELEASE.companionJunk).toEqual([...RELEASE_SUBTITLES]);
    expect(
      cleanOptions(
        {
          ...DEFAULT_CLEAN_FORM,
          profile: 'release',
          junkMaxMb: 2,
          sampleMaxMb: 500,
          junkDirsBesideContent: true,
        },
        true,
      ),
    ).toMatchObject({
      junkMaxBytes: 2 * MIB,
      largeJunkMaxBytes: 500 * MIB,
      junkDirsBesideContent: true,
    });
    // custom = the form of design 008
    const custom = { ...DEFAULT_CLEAN_FORM, profile: 'custom' as const };
    expect(cleanOptions(custom, true)).toMatchObject({
      junk: [],
      patterns: [],
      largeJunk: [],
      companionJunk: [],
    });
    // … not even with everything switched on: subtitles are named by the release profile only
    expect(
      cleanOptions({ ...custom, junkOn: true, patternsOn: true, junkDirsBesideContent: true }, true)
        .companionJunk,
    ).toEqual([]);
    expect(
      cleanOptions(
        { ...custom, junkOn: true, patternsOn: true, patternsText: ' *.bak ; ;*.tmp' },
        true,
      ),
    ).toMatchObject({
      includeRoots: true,
      junk: ['.DS_Store', 'Thumbs.db', 'desktop.ini'],
      patterns: ['*.bak', '*.tmp'],
    });
    // without empty folders there is no junk and no start folder
    expect(cleanOptions({ ...custom, emptyDirs: false, junkOn: true }, true)).toMatchObject({
      junk: [],
      includeRoots: false,
    });
  });

  it('the release lists reach what a release leaves behind – and no ordinary document (review 077 #1)', () => {
    // the matcher of Rust (`*` and `?`, case-insensitive), enough for this check
    const glob = (pattern: string, name: string) =>
      new RegExp(
        `^${pattern
          .toLowerCase()
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
      ).test(name.toLowerCase());
    const extra = (name: string) =>
      [...RELEASE_EXTRAS, ...RELEASE_SAMPLES].some((p) => glob(p, name));
    for (const name of [
      'film.nfo',
      'film.sfv',
      'mobland.s02e08.german.dl.1080p.web.h264-wayne-sample.mkv',
      'Film.Sample.MP4',
      'sample-film.avi',
      'sample.mkv',
      'film-proof.jpg',
      'Film-Proof.PNG',
    ]) {
      expect(extra(name), name).toBe(true);
    }
    for (const name of [
      'sample-vertrag.docx',
      'Angebot-sample.xlsx',
      'config.sample.json',
      'sample.txt',
      'sample-data.csv',
      'Abnahme-proof.pdf',
      'Bank.url',
      'cover.jpg',
      'film.srt',
      'film.rar',
      'film.r00',
      'film.mkv',
      'readme.txt',
      'Sample', // a folder name is no licence
    ]) {
      expect(extra(name), name).toBe(false);
    }
    // 4 sample shapes × the video endings, well below the 100 names Rust takes
    expect(RELEASE_SAMPLES).toHaveLength(4 * VIDEO_EXTENSIONS.length);
    expect(RELEASE_SAMPLES.length + RELEASE_EXTRAS.length + 3).toBeLessThanOrEqual(100);
    // subtitles are no extras of their own: a list apart, by ending only
    for (const name of ['film.srt', 'film.eng.idx', 'film.sub', 'film.sup', 'Film.ASS']) {
      expect(extra(name), name).toBe(false);
      expect(
        RELEASE_SUBTITLES.some((p) => glob(p, name)),
        name,
      ).toBe(true);
    }
    for (const name of ['film.mkv', 'subs.rar', 'notes.txt', 'film.srt.bak']) {
      expect(
        RELEASE_SUBTITLES.some((p) => glob(p, name)),
        name,
      ).toBe(false);
    }
  });

  it('rules that were loosened are never hidden (review 077 #6)', () => {
    const release = { ...DEFAULT_CLEAN_FORM, profile: 'release' as const };
    expect(loosened(DEFAULT_CLEAN_FORM)).toBe(false);
    expect(loosened(release)).toBe(false);
    expect(loosened({ ...release, sampleMaxMb: 5000 })).toBe(true);
    expect(loosened({ ...release, junkMaxMb: 2 })).toBe(true);
    expect(loosened({ ...release, junkDirsBesideContent: true })).toBe(true);
    // stricter is not loosened
    expect(loosened({ ...release, sampleMaxMb: 100, junkMaxMb: 0 })).toBe(false);
    // values kept for another profile do nothing there
    expect(
      loosened({ ...DEFAULT_CLEAN_FORM, sampleMaxMb: 5000, junkDirsBesideContent: true }),
    ).toBe(false);
    const custom = { ...DEFAULT_CLEAN_FORM, profile: 'custom' as const, junkOn: true };
    expect(loosened({ ...custom, junkMaxMb: 50 })).toBe(true);
    expect(loosened({ ...custom, sampleMaxMb: 5000 })).toBe(false);
  });

  it('restores a kept form; one from before 077 becomes "custom" only if it did something', () => {
    expect(restoreCleanForm(undefined)).toEqual(DEFAULT_CLEAN_FORM);
    expect(restoreCleanForm({ junkOn: true, patternsText: '*.tmp' })).toMatchObject({
      profile: 'custom',
      junkOn: true,
      patternsText: '*.tmp',
    });
    expect(restoreCleanForm({ emptyDirs: true, includeRoots: true }).profile).toBe('empty');
    expect(restoreCleanForm({ profile: 'release', sampleMaxMb: 500 })).toMatchObject({
      profile: 'release',
      sampleMaxMb: 500,
      junkMaxMb: 1,
    });
    // nonsense falls back
    expect(
      restoreCleanForm({ profile: 'all', junkMaxMb: -1, sampleMaxMb: 1.5, mode: 'permanent' }),
    ).toEqual(DEFAULT_CLEAN_FORM);
  });

  it('the input follows F8: marked folders, else the folder under the cursor, else the panel folder', () => {
    const file = entry('a.txt', { path: '/src/a.txt' });
    const d1 = dir('A', { path: '/src/A' });
    const d2 = dir('B', { path: '/src/B' });
    const link = entry('L', { path: '/src/L', kind: 'symlink', targetKind: 'directory' });
    const up = { ...dir('..', { path: '/' }), parentLink: true };
    const cases: [string, Parameters<typeof cleanInput>, ReturnType<typeof cleanInput>][] = [
      [
        'marked folders',
        ['/src', [d1, file, d2], file],
        { roots: ['/src/A', '/src/B'], includeRoots: true, ignored: 1 },
      ],
      [
        'a link is no folder',
        ['/src', [d1, link], null],
        { roots: ['/src/A'], includeRoots: true, ignored: 1 },
      ],
      ['cursor folder', ['/src', [], d2], { roots: ['/src/B'], includeRoots: true, ignored: 0 }],
      [
        'cursor on a file',
        ['/src', [], file],
        { roots: ['/src'], includeRoots: false, ignored: 0 },
      ],
      ['cursor on ".."', ['/src', [], up], { roots: ['/src'], includeRoots: false, ignored: 0 }],
      [
        'cursor on a link',
        ['/src', [], link],
        { roots: ['/src'], includeRoots: false, ignored: 0 },
      ],
      // marks win over the cursor – as F8 never deletes the cursor entry next to marks
      [
        'only files marked',
        ['/src', [file], d1],
        { roots: ['/src'], includeRoots: false, ignored: 1 },
      ],
      ['no cursor', ['/src', [], null], { roots: ['/src'], includeRoots: false, ignored: 0 }],
    ];
    for (const [name, args, want] of cases) {
      expect(cleanInput(...args), name).toEqual(want);
    }
  });

  it("Marc's folders: rows, preselection, sums and what the job gets", () => {
    const scan = marcsScan();
    const selected = selection(scan, new Set());
    expect([...selected]).toEqual(['/f/Mein Land', '/f/Miss Merkel', '/f/MobLand S02']);
    const rows = rootRows(scan, selected, RELEASE);
    expect(rows.map((r) => [r.check, r.verdict, r.selectable])).toEqual([
      ['–', 'stays', false],
      ['☑', 'leftover', true],
      ['☑', 'leftover', true],
      ['☑', 'leftover', true],
    ]);
    expect(rows[0].removes).toBe('–');
    expect(rows[0].keeps).toMatch(/^3 files · .* \(\.cbr\)$/);
    expect(rows[1].removes).toMatch(/^2 folders · 1 file · 736/);
    expect(rows[1].keeps).toBe('–');
    expect(rows[3].removes).toMatch(/^7 folders · 6 files · /);
    expect(sums(scan, selected)).toEqual({
      roots: 3,
      dirs: 11,
      files: 8,
      bytes: 736 + 647 + 212_024_204,
    });
    // taking one out
    const without = selection(scan, new Set(['/f/MobLand S02']));
    expect(rootRows(scan, without, RELEASE)[3].check).toBe('☐');
    expect(sums(scan, without)).toEqual({ roots: 2, dirs: 4, files: 2, bytes: 1383 });
    const items = jobItems(scan, without);
    expect(items).toEqual([
      { path: '/f/Mein Land/Rel', kind: 'dir' },
      { path: '/f/Mein Land', kind: 'dir' },
      { path: '/f/Miss Merkel/Rel', kind: 'dir' },
      { path: '/f/Miss Merkel', kind: 'dir' },
    ]);
    // a folder that stays is never selected, whatever the set says
    expect(sums(scan, new Set(['/f/Lustiges Taschenbuch']))).toMatchObject({ dirs: 0, bytes: 0 });
    expect(selection(null, new Set()).size).toBe(0);
  });

  it('says why a folder stays', () => {
    const o: CleanOptions = RELEASE;
    const own: CleanOptions = { ...RELEASE, includeRoots: false };
    const v = (over: Partial<RootVerdict>) => rootVerdict('/f/x', over);
    const cases: [string, RootVerdict, CleanOptions, RegExp][] = [
      [
        'content',
        v({ keepFiles: 1, keepBytes: 5, keepExtensions: ['.mkv', '.srt'] }),
        o,
        /^1 file · 5 B \(\.mkv, \.srt\)$/,
      ],
      [
        'huge sample',
        v({ keepFiles: 1, keepBytes: 4e9, sampleTooLarge: 1 }),
        o,
        /^sample larger than 300.*· 1 file/,
      ],
      [
        'large extras',
        v({ keepFiles: 2, keepBytes: 9, tooLarge: 2 }),
        o,
        /^2 extras larger than 1.*· 2 files/,
      ],
      ['hidden', v({ keepFiles: 1, keepBytes: 1, hidden: 1 }), o, /1 hidden entry$/],
      ['links', v({ links: 2 }), o, /^2 links$/],
      ['blocked', v({ blocked: 1 }), o, /^1 entry that cannot be checked$/],
      [
        'extras next to content',
        v({ keepFiles: 1, keepBytes: 1, junkKept: 2 }),
        o,
        /2 extras stay next to content$/,
      ],
      ['home', v({ danger: 'home' }), o, /^your home folder is never deleted$/],
      ['linked', v({ linked: true }), o, /^reached through a link/],
      [
        'panel folder with extras only',
        v({ junkKept: 3 }),
        own,
        /^only 3 extras · the folder of the panel itself stays$/,
      ],
      ['empty panel folder', v({}), own, /^the folder of the panel itself stays$/],
      ['incomplete', v({ incomplete: true, keepFiles: 9 }), o, /^not searched completely$/],
      [
        'partial with content',
        v({ verdict: 'partial', count: 1, keepFiles: 1, keepBytes: 1 }),
        o,
        /^1 file · 1 B$/,
      ],
    ];
    for (const [name, verdict, options, want] of cases) {
      expect(keepsText(verdict, options), name).toMatch(want);
    }
    expect(removesText(v({ count: 2, removeDirs: 2, removeFiles: 1, removeBytes: 3 }))).toBe(
      '2 folders · 1 file · 3 B',
    );
  });

  it('details: what goes (children first) and what stays, with the reason', () => {
    const scan = cleanScan([
      {
        path: '/f/Film',
        items: [
          { path: '/f/Film/leer', kind: 'dir', rel: 'leer' },
          {
            path: '/f/Film/Sample',
            kind: 'dir',
            rel: 'Sample',
            junk: 7,
            bytes: 10,
            junkNames: ['a', 'b', 'c', 'd', 'e'],
          },
          { path: '/f/Film/x.bak', kind: 'file', rel: 'x.bak', bytes: 3 },
          { path: '/f/Film', kind: 'dir', rel: '' },
        ],
        over: {
          keepFiles: 30,
          keepSample: [
            { rel: 'film.mkv', bytes: 100, reason: 'content' },
            { rel: 'Sample/big-sample.mkv', bytes: 5, reason: 'sampleTooLarge' },
            { rel: 'x.nfo', bytes: 5, reason: 'tooLarge' },
            { rel: 'zu', bytes: 0, reason: 'unreadable' },
          ],
        },
      },
    ]);
    const rows = detailRows(scan, scan.roots[0], RELEASE);
    expect(rows.map((r) => [r.what, r.entry])).toEqual([
      ['goes', 'leer'],
      ['goes', 'Sample'],
      ['goes', 'x.bak'],
      ['goes', '(the folder itself)'],
      ['stays', 'film.mkv'],
      ['stays', 'Sample/big-sample.mkv'],
      ['stays', 'x.nfo'],
      ['stays', 'zu'],
      ['stays', '… and 26 entries more'],
    ]);
    expect(rows[0].info).toBe('empty folder');
    expect(rows[1].info).toBe('with 7 extras (10 B): a, b, c, d, e …');
    expect(rows[2].info).toBe('matches the delete pattern');
    expect(rows[4].info).toBe('content');
    expect(rows[5].info).toMatch(/^sample larger than 300/);
    expect(rows[6].info).toMatch(/^extra larger than 1/);
    expect(rows[7]).toMatchObject({ info: 'not readable', size: '', stays: true });
    expect(detailRows(scan, null, RELEASE)).toEqual([]);
  });
});
