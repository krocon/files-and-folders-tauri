import type { Platform } from '../../core/actions/platform';
import type { ApplyTo, AttrChange, TimeValue } from '../../core/attributes/attributes.models';
import type { Properties } from '../../core/preview/preview.models';

/** Tri-state of a permission bit or attribute over all selected entries (design 024 E9). */
export type Tri = 'on' | 'off' | 'mixed';

/** One checkbox: shown value, value of the selection, touched by the user. */
export interface TriField {
  readonly value: Tri;
  readonly initial: Tri;
  readonly touched: boolean;
}

export type Who = 'owner' | 'group' | 'others';
export type What = 'read' | 'write' | 'exec';
export type Special = 'setuid' | 'setgid' | 'sticky';
export type FlagName = 'readonly' | 'hidden' | 'system' | 'archive';
export type TimeName = 'modified' | 'accessed' | 'created';

export const WHO: readonly Who[] = ['owner', 'group', 'others'];
export const WHAT: readonly What[] = ['read', 'write', 'exec'];
export const SPECIAL: readonly Special[] = ['setuid', 'setgid', 'sticky'];

/** Bit of `rwx` for owner/group/others. */
export function rwxBit(who: Who, what: What): number {
  const shift = { owner: 6, group: 3, others: 0 }[who];
  return { read: 4, write: 2, exec: 1 }[what] << shift;
}

export const SPECIAL_BIT: Readonly<Record<Special, number>> = {
  setuid: 0o4000,
  setgid: 0o2000,
  sticky: 0o1000,
};

/** The 12 permission bits, highest first. */
export const MODE_BITS: readonly number[] = [
  ...SPECIAL.map((s) => SPECIAL_BIT[s]),
  ...WHO.flatMap((w) => WHAT.map((x) => rwxBit(w, x))),
];
const RWX_MASK = 0o777;

/** One time row: change it at all, "now" or the value of the date/time field. */
export interface TimeField {
  readonly enabled: boolean;
  readonly now: boolean;
  /** `YYYY-MM-DDTHH:mm:ss` (local time, `<input type="datetime-local">`). */
  readonly value: string;
}

export interface AttrForm {
  /** Keyed by the bit (`0o400` …). */
  readonly bits: Readonly<Record<number, TriField>>;
  readonly flags: Readonly<Record<FlagName, TriField>>;
  readonly times: Readonly<Record<TimeName, TimeField>>;
  readonly recursive: boolean;
  readonly applyTo: ApplyTo;
}

/** What the dialog shows on an OS (design 024 E6; Rust `attributes::SUPPORTED`). */
export interface Fields {
  readonly mode: boolean;
  readonly flags: readonly FlagName[];
  readonly times: readonly TimeName[];
}

export function fieldsFor(platform: Platform): Fields {
  switch (platform) {
    case 'windows':
      return {
        mode: false,
        flags: ['readonly', 'hidden', 'system', 'archive'],
        times: ['modified', 'accessed', 'created'],
      };
    case 'macos':
      return { mode: true, flags: ['hidden'], times: ['modified', 'accessed', 'created'] };
    default:
      return { mode: true, flags: [], times: ['modified', 'accessed'] };
  }
}

/** All the same → on/off; nothing known or different values → mixed. */
export function triOf(values: readonly boolean[]): Tri {
  if (values.length === 0) {
    return 'mixed';
  }
  return values.every((v) => v) ? 'on' : values.every((v) => !v) ? 'off' : 'mixed';
}

function field(initial: Tri): TriField {
  return { value: initial, initial, touched: false };
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** Milliseconds → value of a `datetime-local` field (local time, seconds). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Value of a `datetime-local` field → milliseconds (`null` = invalid or empty). */
export function fromLocalInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) {
    return null;
  }
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const date = new Date(y, mo - 1, d, h, mi, s);
  // 2026-02-31 would roll over into March, 02:30 in the gap of the switch to
  // summer time silently into 03:30 (external review #12) – no valid input
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return null;
  }
  return date.getTime();
}

/**
 * Start values from the properties of the selected entries (links excluded by
 * the caller). `null` = not known (too many entries, error): everything mixed.
 */
export function initialForm(
  props: readonly Properties[] | null,
  fields: Fields,
  now: number,
): AttrForm {
  const list = props ?? [];
  const unix = list.map((p) => p.unix).filter((u) => u !== null);
  const bits: Record<number, TriField> = {};
  for (const bit of MODE_BITS) {
    bits[bit] = field(triOf(unix.map((u) => (u.mode & bit) !== 0)));
  }
  const flagValues = (name: FlagName): boolean[] =>
    list.flatMap((p) => {
      if (p.windows) {
        return [p.windows[name]];
      }
      const hidden = p.unix?.flagsHidden;
      return name === 'hidden' && typeof hidden === 'boolean' ? [hidden] : [];
    });
  const flag = (name: FlagName) =>
    field(fields.flags.includes(name) ? triOf(flagValues(name)) : 'mixed');
  const first = list[0];
  const time = (ms: number | null | undefined): TimeField => ({
    enabled: false,
    now: false,
    value: toLocalInput(ms ?? now),
  });
  return {
    bits,
    flags: {
      readonly: flag('readonly'),
      hidden: flag('hidden'),
      system: flag('system'),
      archive: flag('archive'),
    },
    times: {
      modified: time(first?.modifiedMs),
      accessed: time(first?.accessedMs),
      created: time(first?.createdMs),
    },
    recursive: false,
    applyTo: 'all',
  };
}

/**
 * Next value of a checkbox: on → off → on; a field that started mixed also
 * goes back to "unchanged": mixed → on → off → mixed.
 */
export function cycle(f: TriField): TriField {
  const value: Tri =
    f.value === 'mixed' ? 'on' : f.value === 'on' ? 'off' : f.initial === 'mixed' ? 'mixed' : 'on';
  return { ...f, value, touched: true };
}

export function toggleBit(form: AttrForm, bit: number): AttrForm {
  return { ...form, bits: { ...form.bits, [bit]: cycle(form.bits[bit]) } };
}

export function toggleFlag(form: AttrForm, name: FlagName): AttrForm {
  return { ...form, flags: { ...form.flags, [name]: cycle(form.flags[name]) } };
}

export function setTime(form: AttrForm, name: TimeName, patch: Partial<TimeField>): AttrForm {
  return { ...form, times: { ...form.times, [name]: { ...form.times[name], ...patch } } };
}

/** Octal notation of the shown bits (`644`, `4755`); empty while a bit is mixed. */
export function octalOf(form: AttrForm): string {
  let mode = 0;
  for (const bit of MODE_BITS) {
    const v = form.bits[bit].value;
    if (v === 'mixed') {
      return '';
    }
    if (v === 'on') {
      mode |= bit;
    }
  }
  return mode.toString(8).padStart(mode > RWX_MASK ? 4 : 3, '0');
}

/**
 * Typed octal mode: 3 digits set the nine rwx bits, 4 digits all twelve – as
 * touched, determinate values. `null` = not a mode.
 */
export function applyOctal(form: AttrForm, text: string): AttrForm | null {
  const t = text.trim();
  if (!/^[0-7]{3,4}$/.test(t)) {
    return null;
  }
  const mode = parseInt(t, 8);
  const mask = t.length === 4 ? 0o7777 : RWX_MASK;
  const bits = { ...form.bits };
  for (const bit of MODE_BITS) {
    if (bit & mask) {
      bits[bit] = { ...bits[bit], value: mode & bit ? 'on' : 'off', touched: true };
    }
  }
  return { ...form, bits };
}

/** A setuid/setgid/sticky bit is about to be set (warning, E6). */
export function setsSpecialBit(form: AttrForm): boolean {
  return SPECIAL.some((s) => {
    const f = form.bits[SPECIAL_BIT[s]];
    return f.touched && f.value === 'on';
  });
}

/** Enabled time rows with an invalid date/time. */
export function invalidTimes(form: AttrForm, fields: Fields): TimeName[] {
  return fields.times.filter((n) => {
    const t = form.times[n];
    return t.enabled && !t.now && fromLocalInput(t.value) === null;
  });
}

/** The change the job gets: only touched, determinate fields (E9) and enabled times. */
export function buildChange(form: AttrForm, fields: Fields): AttrChange {
  let modeSet = 0;
  let modeClear = 0;
  if (fields.mode) {
    for (const bit of MODE_BITS) {
      const f = form.bits[bit];
      if (f.touched && f.value === 'on') {
        modeSet |= bit;
      } else if (f.touched && f.value === 'off') {
        modeClear |= bit;
      }
    }
  }
  const change: { -readonly [K in keyof AttrChange]: AttrChange[K] } = {};
  if (modeSet) {
    change.modeSet = modeSet;
  }
  if (modeClear) {
    change.modeClear = modeClear;
  }
  for (const name of fields.flags) {
    const f = form.flags[name];
    if (f.touched && f.value !== 'mixed') {
      change[name] = f.value === 'on';
    }
  }
  for (const name of fields.times) {
    const t = form.times[name];
    if (!t.enabled) {
      continue;
    }
    if (t.now) {
      change[name] = { type: 'now' } satisfies TimeValue;
    } else {
      const ms = fromLocalInput(t.value);
      if (ms !== null) {
        change[name] = { type: 'at', ms };
      }
    }
  }
  return change;
}

const bitCount = (n: number) => n.toString(2).replace(/0/g, '').length;

/** Number of single changes (bits, attributes, times) – "x entries · y changes". */
export function countChanges(c: AttrChange): number {
  const flags = (['readonly', 'hidden', 'system', 'archive'] as const).filter(
    (n) => c[n] !== undefined && c[n] !== null,
  ).length;
  const times = (['modified', 'accessed', 'created'] as const).filter((n) => !!c[n]).length;
  return bitCount(c.modeSet ?? 0) + bitCount(c.modeClear ?? 0) + flags + times;
}

/** Symbolic form of a mode change for the summary: `u+w g-x o-rwx +s`. */
export function symbolicMode(c: AttrChange): string {
  const parts: string[] = [];
  const letters: Record<What, string> = { read: 'r', write: 'w', exec: 'x' };
  const short: Record<Who, string> = { owner: 'u', group: 'g', others: 'o' };
  for (const who of WHO) {
    const add = WHAT.filter((w) => (c.modeSet ?? 0) & rwxBit(who, w));
    const del = WHAT.filter((w) => (c.modeClear ?? 0) & rwxBit(who, w));
    const u = short[who];
    if (add.length) {
      parts.push(`${u}+${add.map((w) => letters[w]).join('')}`);
    }
    if (del.length) {
      parts.push(`${u}-${del.map((w) => letters[w]).join('')}`);
    }
  }
  const special: Record<Special, string> = { setuid: 'u±s', setgid: 'g±s', sticky: '±t' };
  for (const s of SPECIAL) {
    const bit = SPECIAL_BIT[s];
    if ((c.modeSet ?? 0) & bit) {
      parts.push(special[s].replace('±', '+'));
    }
    if ((c.modeClear ?? 0) & bit) {
      parts.push(special[s].replace('±', '-'));
    }
  }
  return parts.join(' ');
}
