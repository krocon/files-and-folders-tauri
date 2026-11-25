# Test data of the download protocol (design 078)

`synthetic-*.txt` are **synthetic**: written by hand from the templates in `../args.rs`
(`--progress-template`, `--print`) and from yt-dlp's source (2026.11.23), with the marker
replaced by `M`. They were not recorded from a run – the session that built the feature
did not run yt-dlp against any URL.

To record real lines (Marc's acceptance – it uses the network):

```bash
cd src-tauri
FNF_RECORD_URL='https://…' cargo test record_protocol_lines -- --ignored --nocapture
FNF_RECORD_URL='https://…' FNF_RECORD_AUDIO=1 cargo test record_protocol_lines -- --ignored --nocapture
```

writes `recorded-video.txt` / `recorded-audio.txt` here (`FNF_RECORD_NAME=playlist` for another
name): exactly the arguments of a job, marker replaced by `M`, stderr lines prefixed `E `, the
target folder by `/ziel`. Compare them with the synthetic files and add them to the parser tests in
`../progress.rs` where they differ.

Without network, the option names and value types can be checked against the installed yt-dlp:
`cargo test real_yt_dlp_accepts_the_arguments -- --ignored --nocapture`, and what the dialog would
find on this machine: `cargo test probe_this_machine -- --ignored --nocapture`.
