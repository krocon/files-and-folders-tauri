import { describe, expect, it } from 'vitest';
import type { Properties } from '../../core/preview/preview.models';
import {
  applyOctal,
  buildChange,
  countChanges,
  cycle,
  fieldsFor,
  fromLocalInput,
  initialForm,
  invalidTimes,
  octalOf,
  rwxBit,
  setsSpecialBit,
  setTime,
  symbolicMode,
  toggleBit,
  toggleFlag,
  toLocalInput,
  triOf,
} from './attributes-logic';

const LINUX = fieldsFor('linux');
const MAC = fieldsFor('macos');
const WIN = fieldsFor('windows');
const NOW = new Date(2026, 9, 20, 12, 30, 15).getTime();

function props(over: Partial<Properties> = {}, mode = 0o644): Properties {
  return {
    name: 'f',
    path: '/f',
    kind: 'file',
    targetKind: null,
    linkTarget: null,
    size: 1,
    createdMs: null,
    modifiedMs: NOW - 1000,
    accessedMs: null,
    readonly: false,
    format: null,
    unix: { mode, uid: 1, gid: 1, owner: 'u', group: 'g', flagsHidden: null },
    windows: null,
    ...over,
  };
}

describe('change attributes – pure logic (design 024)', () => {
  it('fields per OS', () => {
    expect(LINUX).toEqual({ mode: true, flags: [], times: ['modified', 'accessed'] });
    expect(MAC.flags).toEqual(['hidden']);
    expect(MAC.times).toContain('created');
    expect(WIN.mode).toBe(false);
    expect(WIN.flags).toEqual(['readonly', 'hidden', 'system', 'archive']);
  });

  it('tri-state over the selection', () => {
    expect(triOf([true, true])).toBe('on');
    expect(triOf([false])).toBe('off');
    expect(triOf([true, false])).toBe('mixed');
    expect(triOf([])).toBe('mixed');
    const f = initialForm([props({}, 0o644), props({}, 0o664)], LINUX, NOW);
    expect(f.bits[rwxBit('owner', 'read')].value).toBe('on');
    expect(f.bits[rwxBit('group', 'write')].value).toBe('mixed');
    expect(f.bits[rwxBit('others', 'exec')].value).toBe('off');
    expect(f.bits[0o4000].value).toBe('off');
    expect(octalOf(f), 'a bit differs').toBe('');
    expect(octalOf(initialForm([props({}, 0o4755)], LINUX, NOW))).toBe('4755');
    expect(octalOf(initialForm([props({}, 0o600)], LINUX, NOW))).toBe('600');
    // unknown (too many entries): everything mixed
    const unknown = initialForm(null, LINUX, NOW);
    expect(Object.values(unknown.bits).every((b) => b.value === 'mixed')).toBe(true);
    expect(unknown.times.modified.value).toBe(toLocalInput(NOW));
  });

  it('windows and macOS attributes come from the properties', () => {
    const w = (readonly: boolean, hidden: boolean) =>
      props({ unix: null, windows: { readonly, hidden, system: false, archive: true } });
    const f = initialForm([w(true, false), w(true, true)], WIN, NOW);
    expect(f.flags.readonly.value).toBe('on');
    expect(f.flags.hidden.value).toBe('mixed');
    expect(f.flags.system.value).toBe('off');
    expect(f.flags.archive.value).toBe('on');
    const mac = initialForm(
      [
        props({
          unix: { mode: 0o644, uid: 1, gid: 1, owner: null, group: null, flagsHidden: true },
        }),
      ],
      MAC,
      NOW,
    );
    expect(mac.flags.hidden.value).toBe('on');
  });

  it('a click cycles on → off → on, a mixed field also back to "unchanged"', () => {
    const det = { value: 'off' as const, initial: 'off' as const, touched: false };
    const a = cycle(det);
    expect(a).toEqual({ value: 'on', initial: 'off', touched: true });
    expect(cycle(a).value).toBe('off');
    expect(cycle(cycle(a)).value).toBe('on');
    const mixed = { value: 'mixed' as const, initial: 'mixed' as const, touched: false };
    expect(
      [cycle(mixed), cycle(cycle(mixed)), cycle(cycle(cycle(mixed)))].map((f) => f.value),
    ).toEqual(['on', 'off', 'mixed']);
  });

  it('only touched, determinate fields become the change – also when equal to the start (recursion)', () => {
    let f = initialForm([props({}, 0o644), props({}, 0o664)], LINUX, NOW);
    expect(buildChange(f, LINUX)).toEqual({});
    f = toggleBit(f, rwxBit('group', 'write')); // mixed → on
    f = toggleBit(f, rwxBit('others', 'read')); // on → off
    f = toggleBit(f, rwxBit('owner', 'exec')); // off → on …
    f = toggleBit(f, rwxBit('owner', 'exec')); // … → off: touched, equals the start
    const c = buildChange(f, LINUX);
    expect(c).toEqual({ modeSet: 0o020, modeClear: 0o104 });
    expect(countChanges(c)).toBe(3);
    expect(symbolicMode(c)).toBe('u-x g+w o-r');
    // a mixed field that went round is not sent
    f = toggleBit(toggleBit(f, rwxBit('group', 'write')), rwxBit('group', 'write'));
    expect(buildChange(f, LINUX).modeSet ?? 0).toBe(0);
    // mode fields are ignored where the OS has none
    expect(buildChange(f, WIN)).toEqual({});
  });

  it('octal input: 3 digits set the nine rwx bits, 4 digits all twelve', () => {
    const start = initialForm([props({}, 0o4644), props({}, 0o600)], LINUX, NOW);
    expect(applyOctal(start, '64')).toBeNull();
    expect(applyOctal(start, '0789')).toBeNull();
    const three = applyOctal(start, '750')!;
    expect(octalOf(three), 'setuid still differs').toBe('');
    expect(buildChange(three, LINUX)).toEqual({ modeSet: 0o750, modeClear: 0o027 });
    const four = applyOctal(start, '2750')!;
    expect(octalOf(four)).toBe('2750');
    expect(buildChange(four, LINUX)).toEqual({ modeSet: 0o2750, modeClear: 0o5027 });
    expect(setsSpecialBit(four)).toBe(true);
    expect(setsSpecialBit(three)).toBe(false);
    expect(symbolicMode({ modeSet: 0o2000, modeClear: 0o1000 })).toBe('g+s -t');
  });

  it('attributes and times', () => {
    let f = initialForm(null, WIN, NOW);
    f = toggleFlag(f, 'hidden'); // mixed → on
    f = toggleFlag(toggleFlag(f, 'readonly'), 'readonly'); // mixed → on → off
    f = setTime(f, 'modified', { enabled: true, now: true });
    f = setTime(f, 'created', { enabled: true, value: '2001-02-03T04:05:06' });
    const c = buildChange(f, WIN);
    expect(c).toEqual({
      hidden: true,
      readonly: false,
      modified: { type: 'now' },
      created: { type: 'at', ms: new Date(2001, 1, 3, 4, 5, 6).getTime() },
    });
    expect(countChanges(c)).toBe(4);
    // created is not sent where the OS cannot set it
    expect(buildChange(f, LINUX)).toEqual({ modified: { type: 'now' } });
    const bad = setTime(f, 'accessed', { enabled: true, value: '2026-02-31T10:00' });
    expect(invalidTimes(bad, WIN)).toEqual(['accessed']);
    expect(invalidTimes(f, WIN)).toEqual([]);
  });

  it('datetime-local values round-trip in local time', () => {
    expect(toLocalInput(NOW)).toBe('2026-10-20T12:30:15');
    expect(fromLocalInput('2026-10-20T12:30:15')).toBe(NOW);
    expect(fromLocalInput('2026-10-20T12:30')).toBe(NOW - 15_000);
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('20.10.2026')).toBeNull();
    expect(fromLocalInput('2026-13-01T00:00')).toBeNull();
  });

  it('a time in the gap of the switch to summer time is no valid input (review #12)', () => {
    vi.stubEnv('TZ', 'Europe/Berlin'); // Node switches the time zone on assignment
    try {
      expect(fromLocalInput('2026-03-29T02:30')).toBeNull();
      expect(fromLocalInput('2026-03-29T03:30')).toBe(Date.UTC(2026, 2, 29, 1, 30));
      expect(fromLocalInput('2026-03-29T01:59:59')).toBe(Date.UTC(2026, 2, 29, 0, 59, 59));
      // the hour that exists twice in autumn is valid (the first one)
      expect(fromLocalInput('2026-10-25T02:30')).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
