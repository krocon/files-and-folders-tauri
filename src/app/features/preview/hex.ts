/** Hex dump of the first bytes (design 010 E8): offset · 16 bytes · ASCII. */
export function hexDump(bytes: readonly number[], width = 16): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += width) {
    const row = bytes.slice(off, off + width);
    const hex = row.map((b) => b.toString(16).padStart(2, '0'));
    const left = hex.slice(0, width / 2).join(' ');
    const right = hex.slice(width / 2).join(' ');
    const hexPart = `${left}${right ? '  ' + right : ''}`.padEnd(width * 3, ' ');
    const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hexPart} |${ascii}|`);
  }
  return lines.join('\n');
}
