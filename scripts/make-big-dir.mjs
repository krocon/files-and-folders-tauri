#!/usr/bin/env node
// Creates a test folder with many empty files (and a few sub folders) for performance checks.
// Usage: node scripts/make-big-dir.mjs <target-dir> [count=100000]
// The target must not exist yet – the script never touches existing folders.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [target, countArg] = process.argv.slice(2);
if (!target) {
  console.error('Usage: node scripts/make-big-dir.mjs <target-dir> [count=100000]');
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`Refusing to write into existing path: ${target}`);
  process.exit(1);
}
const count = Number(countArg ?? 100_000);
mkdirSync(target, { recursive: true });
for (let i = 0; i < 20; i++) {
  mkdirSync(join(target, `Ordner ${i}`));
}
const exts = ['txt', 'jpg', 'pdf', 'md', 'json', 'tar.gz'];
for (let i = 0; i < count; i++) {
  const name = `Datei ${String(i).padStart(6, '0')} – Über.${exts[i % exts.length]}`;
  writeFileSync(join(target, name), i % 7 === 0 ? 'x'.repeat(i % 5000) : '');
}
console.log(`Created ${count} files and 20 folders in ${target}`);
