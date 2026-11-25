# Test data of the download protocol (design 078)

`synthetic-*.txt` are **synthetic**: written by hand from the templates in `../args.rs`
(`--progress-template`, `--print`) and from yt-dlp's source (2026.11.23), with the marker
replaced by `M`. They were not recorded from a run – the session that built the feature
did not run yt-dlp against any URL.

To record real lines (Marc's acceptance): `node scripts/record-ytdlp.mjs <url> [--audio]`
writes `recorded-<name>.txt` here (marker replaced by `M`, stderr lines prefixed `E `).
Add them to the parser tests in `../progress.rs` when they differ from the synthetic ones.
