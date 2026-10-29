// @ts-expect-error node:fs is available in the test runner (vitest), not in the app
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TreeFile } from '../../core/folders/folders.models';
import cases from './series-engine.cases.json';
import {
  cleanupRoots,
  DEFAULT_SERIES_OPTIONS,
  nameMatcher,
  parseEpisode,
  planSeries,
  restoreSeriesOptions,
  seasonFolder,
  SeriesOptions,
  splitList,
  templateMatcher,
} from './series-engine';

const ROOT = '/filme/Serie';

/** A `TreeFile` as `collect_files` sends it, from a path relative to the root (`/`). */
function file(rel: string): TreeFile {
  const parts = rel.split('/');
  const name = parts.pop()!;
  return {
    path: `${ROOT}/${rel}`,
    name,
    size: 1,
    modifiedMs: 0,
    dirs: parts,
    top: parts.length > 0 ? `${ROOT}/${parts[0]}` : null,
    rel,
  };
}

function plan(rels: string[], o: Partial<SeriesOptions> = {}, sameRoot = true) {
  return planSeries(rels.map(file), { ...DEFAULT_SERIES_OPTIONS, ...o }, sameRoot);
}

describe('series engine (design 045 E2)', () => {
  for (const c of cases.parseEpisode) {
    it(`parses ${JSON.stringify(c.name)} → ${JSON.stringify(c.ep)}`, () => {
      const e = parseEpisode(c.name);
      expect(e && [e.season, e.first, e.last]).toEqual(c.ep);
      if (c.series !== undefined) {
        expect(e?.series).toBe(c.series);
      }
    });
  }

  for (const c of cases.seasonFolder) {
    it(`season folder ${JSON.stringify(c.template)} / ${c.season} → ${c.folder}`, () => {
      expect(seasonFolder(c.template, c.season)).toBe(c.folder);
    });
  }

  it('splits lists and matches name patterns like clean.rs (without case)', () => {
    expect(splitList(' a; b ;; c ')).toEqual(['a', 'b', 'c']);
    const m = nameMatcher('*.nfo; *-sample.*; Sample; a?c; x+(y)');
    expect(m('X.NFO')).toBe(true);
    expect(m('a.nfo.mkv')).toBe(false);
    expect(m('show-sample.mkv')).toBe(true);
    expect(m('sample')).toBe(true);
    expect(m('abc')).toBe(true);
    expect(m('abbc')).toBe(false);
    expect(m('x+(y)')).toBe(true); // regex characters are literal
    expect(nameMatcher('')('anything')).toBe(false);
  });

  it("groups Marc's example: 30 episodes into S01–S04, extras and samples ignored", () => {
    const text: string = readFileSync('prompts/045-serien-gruppieren-beispiel.txt', 'utf8');
    const rels = text.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(rels.length).toBe(90);
    const p = plan(rels);
    const by = (s: string) => p.rows.filter((r) => r.status === s);
    expect(by('ok').length).toBe(30);
    expect(by('ignored').length).toBe(60);
    expect(by('ignored').filter((r) => r.reason === 'junkDir').length).toBe(30);
    expect(by('ignored').filter((r) => r.reason === 'junk').length).toBe(30);
    expect(p.seasons.map((s) => [s.folder, s.count])).toEqual([
      ['S01', 12],
      ['S02', 6],
      ['S03', 6],
      ['S04', 6],
    ]);
    expect(p.gaps).toEqual([]);
    expect(p.seriesNames).toEqual(['die kirche bleibt im dorf']);
    const first = by('ok')[0];
    expect(first.file.name).toBe('die.kirche.bleibt.im.dorf.s01e01.german.1080p.web.h264-dmpd.mkv');
    expect(first.folder).toBe('S01');
    expect(p.rows.some((r) => r.duplicate)).toBe(false);
  });

  it('a second run: everything is in its season folder already', () => {
    const p = plan(['S01/show.s01e01.mkv', 's02/show.s02e01.mkv', 'S02/show.s01e02.mkv']);
    expect(p.rows.map((r) => r.status)).toEqual(['inPlace', 'inPlace', 'ok']);
    // into the other side, the same files are not in place
    const other = plan(['S01/show.s01e01.mkv'], {}, false);
    expect(other.rows[0].status).toBe('ok');
  });

  it('takes the season from the release folder when the file name has none', () => {
    const p = plan(['Show.S03E04.German-GRP/grp-show-720p.mkv', 'Ohne Nummer/film.mkv']);
    expect(p.rows[0].episode).toMatchObject({ season: 3, first: 4 });
    expect(p.rows[0].folder).toBe('S03');
    expect(p.rows[1].status).toBe('unrecognized');
  });

  it('filters: other endings, extra patterns and folders; subtitles only on request', () => {
    const rels = [
      'R.S01E01/r.s01e01.mkv',
      'R.S01E01/r.s01e01.srt',
      'R.S01E01/Subs/r.s01e01.idx',
      'R.S01E01/Proof/r.s01e01.mkv',
      'R.S01E01/r.s01e01.sample.mkv',
      'R.S01E01/cover.JPG',
      'R.S01E01/r.s01e01.MP4',
    ];
    const p = plan(rels);
    expect(p.rows.map((r) => [r.status, r.reason])).toEqual([
      ['ok', null],
      ['ignored', 'notVideo'],
      ['ignored', 'notVideo'],
      ['ignored', 'junkDir'],
      ['ignored', 'junk'],
      ['ignored', 'junk'],
      ['ok', null],
    ]);
    const subs = plan(rels, { subtitles: true });
    expect(subs.rows.slice(0, 3).map((r) => [r.status, r.subtitle, r.folder])).toEqual([
      ['ok', false, 'S01'],
      ['ok', true, 'S01'],
      ['ok', true, 'S01'],
    ]);
    // subtitles are no duplicates of their episode
    expect(subs.rows[1].duplicate).toBe(false);
    // own lists: no dot needed, any case
    const own = plan(['a.s01e01.MKV', 'a.s01e02.avi'], { videos: 'mkv' });
    expect(own.rows.map((r) => r.status)).toEqual(['ok', 'ignored']);
  });

  it('marks duplicates, double episodes and gaps; warns about several series', () => {
    const p = plan([
      'show.s01e01.720p.mkv',
      'show.s01e01.1080p.mkv',
      'show.s01e02e03.mkv',
      'show.s01e03.mkv',
      'show.s01e06.mkv',
      'other.show.s02e01.mkv',
    ]);
    expect(p.rows.map((r) => r.duplicate)).toEqual([true, true, true, true, false, false]);
    expect(p.gaps).toEqual([{ folder: 'S01', missing: [4, 5] }]);
    expect(p.seriesNames).toEqual(['other show', 'show']);
    expect(p.seasons.map((s) => s.count)).toEqual([5, 1]);
  });

  it('checks the folder names of the template', () => {
    expect(plan(['a.s01e01.mkv'], { template: 'Alle' }).templateInvalid).toBe(true);
    expect(plan(['a.s01e01.mkv'], { template: 'Alle' }).rows[0].status).toBe('invalid');
    const bad = plan(['a.s01e01.mkv'], { template: 'S{nn}:' });
    expect(bad.rows[0].status).toBe('invalid');
    expect(bad.rows[0].error).not.toBeNull();
    expect(plan(['a.s01e01.mkv'], { template: 'Staffel {n}' }).rows[0].folder).toBe('Staffel 1');
  });

  it('cleanup roots: the first folders of moved files, never a season folder or the root', () => {
    const p = plan([
      'R1.S01E01/r1.s01e01.mkv',
      'R1.S01E01/Sample/r1-sample.mkv',
      'R2.S01E02/sub/r2.s01e02.mkv',
      'R3.S01E03/r3.s01e03.mkv',
      'S02/misplaced.s01e04.mkv',
      'direkt.s01e05.mkv',
      'S01/r.s01e06.mkv',
    ]);
    expect(cleanupRoots(p.rows, new Set([`${ROOT}/R3.S01E03/r3.s01e03.mkv`]), 'S{nn}')).toEqual([
      `${ROOT}/R1.S01E01`,
      `${ROOT}/R2.S01E02`,
    ]);
  });

  it('recognizes the folder names of a template', () => {
    const m = templateMatcher('Staffel {n}');
    expect(m('Staffel 1')).toBe(true);
    expect(m('staffel 12')).toBe(true);
    expect(m('Staffel')).toBe(false);
    expect(templateMatcher('S{nn}')('S100')).toBe(true);
    expect(templateMatcher('S{nn}')('Show.S01E01')).toBe(false);
    expect(templateMatcher('Alle')('Alle')).toBe(false);
    expect(templateMatcher('S*{nn}?')('S*01?')).toBe(true); // no regex characters
    expect(templateMatcher('S*{nn}?')('SS01')).toBe(false);
  });

  it('restores kept options field by field', () => {
    expect(restoreSeriesOptions(undefined)).toEqual(DEFAULT_SERIES_OPTIONS);
    expect(
      restoreSeriesOptions({ template: 'Staffel {n}', subtitles: true, cleanup: 'yes', x: 1 }),
    ).toEqual({ ...DEFAULT_SERIES_OPTIONS, template: 'Staffel {n}', subtitles: true });
  });
});
