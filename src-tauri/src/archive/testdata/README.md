# Test archives (designs 016, 025)

Small archives for `archive/tests*.rs` and `jobs/tests_*.rs`. Each test copies its
fixture into a temporary folder (the password store is keyed by path).

| File | Origin | Content / password |
|---|---|---|
| `longname-400k.tgz` | design 016, generated | TAR.GZ with a 400 KB GNU long-name header |
| `sevenzip-solid.7z` | `7z a -t7z -ms=on -mx=5` (p7zip 16.02, Linux) | `Ünïcödé dir/grüße.txt`, `Ünïcödé dir/sub/deep.txt`, `🎉.txt`, `empty.txt`, `leer/` |
| `sevenzip-enc-names.7z` | `7z a -t7z -pgeheim -mhe=on` | same, names encrypted – `geheim` |
| `sevenzip-enc-data.7z` | `7z a -t7z -pgeheim -mhe=off` | same, data encrypted – `geheim` |
| `zip-aes.zip` | `7z a -tzip -mem=AES256 -pgeheim` | same, WinZip AES-256 – `geheim` |
| `zip-infozip.zip` | design 035 E2E: `zip -qr` (Info-ZIP 3.0, Linux), stored, with the extra fields `UT` (0x5455) and `ux` (0x7875) | `sub/`, `sub/s.txt`, `a.txt` |
| `zip-crypto.zip` | `7z a -tzip -mem=ZipCrypto -pgeheim` | same, ZipCrypto – `geheim` |
| `rar-version.rar`, `rar-unicode.rar`, `rar-solid.rar` | test data of the crate `unrar` 0.5.8 (`data/`, MIT/Apache-2.0, github.com/muja/unrar.rs) | `VERSION` (11 bytes), `te…―st✌`, `.gitignore` |
| `rar-crypted.rar` | same | data encrypted – `unrar` |
| `rar-comment-hpw-password.rar` | same | names encrypted – `password` |
| `rar4-slip.rar` | `make_rar4.py` (this folder): RAR 4 headers written by hand, *stored* entries, no RAR packer | `ok.txt`, `../evil.txt`, `/abs.txt`, `sub/inner.txt`, Unix symlink `link` → `/etc/passwd`, `liar.txt` (declares 3 bytes, holds 10) |
| `sevenzip-solid3.7z`, `sevenzip-solid3-enc.7z` | external review 025 (#4/#8): `7z a -t7z -ms=on` (enc: `-pgeheim`), three files in one solid block (LZMA2) | `sub/`, `sub/a.txt`, `sub/b.txt`, `z.txt` (5000 bytes each) |
| `bomb-header.7z`, `bomb-files.7z` | `make_7z_bombs.py` (this folder, generators of the external review 025 #1/#2) | LZMA header unpacking to 128 MiB; header declaring 2 000 000 files |
| `bomb-zero-start.7z` | same (re-check B1) | `bomb-files.7z` with a zeroed start header (CRC 0 + 20 zero bytes) |
| `bomb-digests.7z` | same (re-check B2) | plain header, pack info with 2^36 streams and "not all defined" CRCs |
| `bomb-bzip2-header.7z` | same (re-check B3) | the 2 000 000-file header packed with BZip2 |
| `bomb-aes-header.7z` | same (re-check B3) | the 2 000 000-file header, LZMA behind AES-256 – `geheim` (2^6 key rounds) |
| `bomb-folders.7z` | same (second re-check N1) | encoded LZMA header (4 KB) unpacking to 30 MiB: 10 000 000 folders of two bytes each |

RAR files cannot be made with free tools (`rar` is proprietary); the crafted one is enough to test
names, links and lying sizes, the crate fixtures cover compression, encryption and Unicode.
