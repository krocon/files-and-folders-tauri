/** Unix mode as `rwxr-xr-x` incl. setuid/setgid/sticky (`s`/`S`, `t`/`T`). */
export function modeString(mode: number): string {
  const bit = (mask: number, c: string) => (mode & mask ? c : '-');
  const special = (exec: boolean, flag: boolean, on: string) =>
    flag ? (exec ? on : on.toUpperCase()) : exec ? 'x' : '-';
  return [
    bit(0o400, 'r'),
    bit(0o200, 'w'),
    special((mode & 0o100) !== 0, (mode & 0o4000) !== 0, 's'),
    bit(0o040, 'r'),
    bit(0o020, 'w'),
    special((mode & 0o010) !== 0, (mode & 0o2000) !== 0, 's'),
    bit(0o004, 'r'),
    bit(0o002, 'w'),
    special((mode & 0o001) !== 0, (mode & 0o1000) !== 0, 't'),
  ].join('');
}

/** Octal notation: `755`, with special bits `4755`. */
export function modeOctal(mode: number): string {
  const m = mode & 0o7777;
  return m.toString(8).padStart(m > 0o777 ? 4 : 3, '0');
}
