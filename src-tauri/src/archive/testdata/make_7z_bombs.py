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

# --- re-check 025 (B1–B3): variants the first pre-check let through -------------
bomb_files = open(os.path.join(out, "bomb-files.7z"), "rb").read()

# B1: start header zeroed (CRC 0 + 20 zero bytes) – sevenz-rust2 then searches the
# last MiB for a header without any CRC and finds the 2 000 000-file header
zeroed = bomb_files[:8] + b"\0" * 24 + bomb_files[32:]
open(os.path.join(out, "bomb-zero-start.7z"), "wb").write(zeroed)

# B2: a plain header whose pack info declares 2^36 streams with CRCs "not all
# defined" – a parser that allocates per declared stream runs out of memory
def plain(hdr):
    start = struct.pack("<QQI", 0, len(hdr), zlib.crc32(hdr))
    return b"7z\xbc\xaf\x27\x1c" + bytes([0, 4]) + struct.pack("<I", zlib.crc32(start)) + start + hdr
hdr = bytes([0x01, 0x04, 0x06]) + num(0) + num(1 << 36) + bytes([0x0A, 0x00, 0xFF, 0x00, 0x00, 0x00])
open(os.path.join(out, "bomb-digests.7z"), "wb").write(plain(hdr))

# B3: the 2 000 000-file header packed with BZip2 instead of LZMA
import bz2
packed = bz2.compress(payload, 9)
hdr = bytes([0x17, 0x06]) + num(0) + num(1) + bytes([0x09]) + num(len(packed)) + bytes([0x00])
hdr += bytes([0x07, 0x0B]) + num(1) + bytes([0x00]) + num(1) + bytes([0x03, 0x04, 0x02, 0x02])
hdr += bytes([0x0C]) + num(len(payload)) + bytes([0x00]) + bytes([0x00])
start = struct.pack("<QQI", len(packed), len(hdr), zlib.crc32(hdr))
sig = b"7z\xbc\xaf\x27\x1c" + bytes([0, 4]) + struct.pack("<I", zlib.crc32(start)) + start
open(os.path.join(out, "bomb-bzip2-header.7z"), "wb").write(sig + packed + hdr)

# B3: the same header behind AES-256 (password "geheim", 2^6 key rounds, as 7-Zip
# lays it out: coder 0 LZMA, coder 1 AES, bind pair LZMA-in ← AES-out)
import hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
cycles, iv = 6, bytes(range(16))
pw = "geheim".encode("utf-16-le")
sha = hashlib.sha256()
for i in range(1 << cycles):
    sha.update(pw + struct.pack("<Q", i))
key = sha.digest()
lz = lzma.compress(payload, format=lzma.FORMAT_RAW, filters=filt)
lz_padded = lz + b"\0" * (-len(lz) % 16)
enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
packed = enc.update(lz_padded) + enc.finalize()
props = bytes([(2 * 5 + 0) * 9 + 3]) + struct.pack("<I", 1 << 20)
aes_props = bytes([0x40 | cycles, 0x0F]) + iv
hdr = bytes([0x17, 0x06]) + num(0) + num(1) + bytes([0x09]) + num(len(packed)) + bytes([0x00])
hdr += bytes([0x07, 0x0B]) + num(1) + bytes([0x00]) + num(2)
hdr += bytes([0x23, 0x03, 0x01, 0x01, 0x05]) + props
hdr += bytes([0x24, 0x06, 0xF1, 0x07, 0x01]) + num(len(aes_props)) + aes_props
hdr += num(0) + num(1)  # bind pair: in 0 (LZMA) <- out 1 (AES)
hdr += bytes([0x0C]) + num(len(payload)) + num(len(lz)) + bytes([0x00]) + bytes([0x00])
start = struct.pack("<QQI", len(packed), len(hdr), zlib.crc32(hdr))
sig = b"7z\xbc\xaf\x27\x1c" + bytes([0, 4]) + struct.pack("<I", zlib.crc32(start)) + start
open(os.path.join(out, "bomb-aes-header.7z"), "wb").write(sig + packed + hdr)

# --- second re-check 025 (N1): 10 000 000 folders of two bytes each (`01 00`), every
# folder costs ~112 bytes in a parser that keeps them – a 30 MiB header from ~5 KB LZMA
nfold = 10_000_000
payload = bytes([0x01, 0x04, 0x07, 0x0B]) + num(nfold) + b"\0" + b"\x01\x00" * nfold
payload += b"\x0C" + b"\0" * nfold + b"\0\0\0"
packed = lzma.compress(payload, format=lzma.FORMAT_RAW, filters=filt)
open(os.path.join(out, "bomb-folders.7z"), "wb").write(archive(len(payload), packed))
