#!/usr/bin/env bash
# Type-checks the Rust backend for Windows and macOS from a Linux machine (clippy -D warnings,
# lib + tests) – without the target's toolchain, SDK or prebuilt standard library.
#
# How: the standard library is built from the Rust sources (`-Zbuild-std`, RUSTC_BOOTSTRAP),
# and C/C++ build scripts (aws-lc-sys, unrar-ng-sys, vswhom-sys) get a placeholder compiler that
# only writes empty outputs. Nothing is linked, so nothing runs: this finds compile errors and
# lints in `#[cfg(windows)]`/`#[cfg(target_os = "macos")]` code, not behaviour. The real test
# is still CI on the three OSes (docs/ci/).
#
# Needs: rustup toolchain, git, network to github.com and crates.io (not static.rust-lang.org).
# Usage: scripts/cross-check.sh [target …]   (default: Windows x64, macOS arm64 + x64)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${FNF_CROSS_DIR:-${TMPDIR:-/tmp}/fnf-cross}"
targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-apple-darwin)

# 1. Rust sources of exactly the installed compiler (library/ only)
sysroot="$(rustc --print sysroot)"
src="$sysroot/lib/rustlib/src/rust/library"
if [ ! -d "$src/std" ]; then
  version="$(rustc --version | awk '{print $2}')"
  echo "rust-src $version from GitHub …"
  rm -rf "$work/rust-src"
  git clone -q --depth 1 --branch "$version" --filter=blob:none --sparse \
    https://github.com/rust-lang/rust "$work/rust-src"
  git -C "$work/rust-src" sparse-checkout set library
  git -C "$work/rust-src" submodule update -q --init --depth 1 library/backtrace
  mkdir -p "$(dirname "$src")"
  ln -sfn "$work/rust-src/library" "$src"
fi

# 2. Placeholder C compiler and archiver (check only – never linked)
fake="$work/fakecc"
mkdir -p "$fake"
cat > "$fake/cc" <<'EOF'
#!/bin/bash
out=""; prev=""
for a in "$@"; do
  case "$a" in
    -E) exit 0 ;;
    --version|-v|-dumpversion) echo "clang version 18.0.0"; exit 0 ;;
    /Fo*|-Fo*) out="${a#?Fo}"; out="${out#:}" ;;
  esac
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
[ -n "$out" ] && { mkdir -p "$(dirname "$out")"; : > "$out"; }
exit 0
EOF
cat > "$fake/ar" <<'EOF'
#!/bin/bash
for a in "$@"; do
  case "$a" in
    /OUT:*|-OUT:*|/out:*|-out:*) f="${a#*:}" ;;
    *.a|*.lib) f="$a" ;;
    *) continue ;;
  esac
  mkdir -p "$(dirname "$f")"; printf '!<arch>\n' > "$f"; break
done
exit 0
EOF
chmod +x "$fake/cc" "$fake/ar"

# 3. clippy per target (own target dir: the std of each target is built once and kept)
status=0
for t in "${targets[@]}"; do
  v="${t//-/_}"
  echo "== $t"
  if ! env RUSTC_BOOTSTRAP=1 CARGO_INCREMENTAL=0 CARGO_TARGET_DIR="$work/target" \
    "CC_$v=$fake/cc" "CXX_$v=$fake/cc" "AR_$v=$fake/ar" \
    cargo clippy --manifest-path "$root/src-tauri/Cargo.toml" --target "$t" \
    -Zbuild-std=std,panic_abort --all-targets --locked -- -D warnings; then
    status=1
  fi
done
exit $status
