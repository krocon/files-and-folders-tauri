#!/usr/bin/env python3
"""Writes the 7z header bombs of the external review 025 (#1/#2, generators by the
reviewer, /tmp/review-025/gen): an LZMA-encoded header that unpacks to 128 MiB
(bomb-header.7z, 19 KB) and a header that declares 2 000 000 files (bomb-files.7z,
424 bytes). Usage: make_7z_bombs.py <dir>"""
import lzma, struct, zlib, sys, os

def num(v):  # 7z variable-length number
    if v < 0x80:
        return bytes([v])
    for n in range(1, 9):
        if n == 8 or v < (1 << (8 * n + 7 - n)):
            if n == 8:
                return b"\xff" + struct.pack("<Q", v)
            first = (0xff << (8 - n)) & 0xff | (v >> (8 * n))
            return bytes([first]) + (v & ((1 << (8 * n)) - 1)).to_bytes(n, "little")

def archive(payload_len, packed):
    props = bytes([(2 * 5 + 0) * 9 + 3]) + struct.pack("<I", 1 << 20)
    hdr = bytes([0x17, 0x06]) + num(0) + num(1) + bytes([0x09]) + num(len(packed)) + bytes([0x00])
    hdr += bytes([0x07, 0x0B]) + num(1) + bytes([0x00]) + num(1) + bytes([0x23, 0x03, 0x01, 0x01, 0x05]) + props
    hdr += bytes([0x0C]) + num(payload_len) + bytes([0x00]) + bytes([0x00])
    start = struct.pack("<QQI", len(packed), len(hdr), zlib.crc32(hdr))
    sig = b"7z\xbc\xaf\x27\x1c" + bytes([0, 4]) + struct.pack("<I", zlib.crc32(start)) + start
    return sig + packed + hdr

filt = [{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 20, "lc": 3, "lp": 0, "pb": 2}]
out = sys.argv[1] if len(sys.argv) > 1 else "."
size = 128 << 20
c = lzma.LZMACompressor(format=lzma.FORMAT_RAW, filters=filt)
packed = b"".join(c.compress(b"\0" * (64 << 20)) for _ in range(size >> 26)) + c.flush()
open(os.path.join(out, "bomb-header.7z"), "wb").write(archive(size, packed))
nf = 2_000_000
payload = bytes([0x01, 0x05]) + num(nf)
payload += b"\0" * (nf + 16 - len(payload))
packed = lzma.compress(payload, format=lzma.FORMAT_RAW, filters=filt)
open(os.path.join(out, "bomb-files.7z"), "wb").write(archive(len(payload), packed))
