#!/usr/bin/env python3
"""Writes rar4-slip.rar: a tiny RAR 4 archive with *stored* entries and unsafe
names, made from the public RAR 4 header layout (technote.txt of RAR 4) – no
RAR packer involved. Used by `archive/tests_formats.rs` (design 025 E3)."""
import struct, sys, zlib

def block(head_type, flags, body):
    size = 7 + len(body)
    raw = struct.pack('<BHH', head_type, flags, size) + body
    return struct.pack('<H', zlib.crc32(raw) & 0xFFFF) + raw

def entry(name, data, attr, host=3, unp=None, directory=False):
    n = name.encode()
    flags = 0x8000 | (0xE0 if directory else 0)
    body = struct.pack('<IIBIIBBHI', len(data), len(data) if unp is None else unp, host,
                       zlib.crc32(data) & 0xFFFFFFFF, 0x5A6B1234, 20, 0x30, len(n), attr) + n
    return block(0x74, flags, body) + data

out = b'Rar!\x1a\x07\x00' + block(0x73, 0, b'\x00' * 6)
out += entry('ok.txt', b'fine\n', 0o100644)
out += entry('../evil.txt', b'evil\n', 0o100644)
out += entry('/abs.txt', b'abs\n', 0o100644)
out += entry('sub', b'', 0o40755, directory=True)
out += entry('sub/inner.txt', b'inner\n', 0o100644)
out += entry('link', b'/etc/passwd', 0o120777)
out += entry('liar.txt', b'0123456789', 0o100644, unp=3)
out += block(0x7B, 0x4000, b'')
open(sys.argv[1] if len(sys.argv) > 1 else 'rar4-slip.rar', 'wb').write(out)
