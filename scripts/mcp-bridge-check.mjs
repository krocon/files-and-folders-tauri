#!/usr/bin/env node
// Checks the MCP bridge of a built binary (design 071 E1/E2) without the app:
//
//   node scripts/mcp-bridge-check.mjs [path-to-binary]
//
// Starts `<binary> --mcp` with the socket pointed at a path where nothing listens
// (FNF_MCP_SOCKET in a fresh temp folder – never the socket of a running app), speaks MCP
// over stdin/stdout and expects: `initialize` and `tools/list` answered by the bridge
// itself, every `tools/call` ending with the error `mcp_disabled`, no window, exit when
// stdin closes. Default binary: the debug build (`pnpm tauri build --debug --no-bundle`).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.platform === 'win32' ? '.exe' : '';
const binary = process.argv[2] ?? join(root, 'src-tauri/target/debug', `files-and-folders-tauri${exe}`);
if (!existsSync(binary)) {
  console.error(`binary not found: ${binary}\nbuild it with: pnpm tauri build --debug --no-bundle`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'fnf-mcp-'));
const child = spawn(binary, ['--mcp'], {
  env: { ...process.env, FNF_MCP_SOCKET: join(dir, 'nobody-listens.sock') },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const answers = [];
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line.trim()) answers.push(JSON.parse(line));
  }
});

const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
send({
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bridge-check', version: '1' },
  },
});
send({ method: 'notifications/initialized' });
send({ id: 2, method: 'tools/list' });
send({ id: 3, method: 'tools/call', params: { name: 'get_selection', arguments: {} } });
send({ id: 4, method: 'tools/call', params: { name: 'run_shell', arguments: { command: 'id' } } });
child.stdin.end();

const timeout = setTimeout(() => {
  child.kill();
  fail('the bridge did not exit after stdin closed');
}, 15000);

function fail(message) {
  console.error(`✗ ${message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

function expect(condition, message) {
  if (!condition) fail(message);
  console.log(`✓ ${message}`);
}

child.on('exit', (code) => {
  clearTimeout(timeout);
  const byId = (id) => answers.find((a) => a.id === id);
  expect(code === 0, 'the bridge exits with 0 when stdin closes');
  expect(byId(1)?.result?.serverInfo?.name === 'files-and-folders', 'initialize is answered');
  expect(byId(1)?.result?.protocolVersion === '2025-06-18', 'the protocol version is echoed');
  const tools = byId(2)?.result?.tools ?? [];
  expect(tools.length > 0, `tools/list names ${tools.length} tools`);
  const names = tools.map((t) => t.name);
  for (const forbidden of ['run_shell', 'open_file', 'run_tool', 'remote_connect', 'save_settings']) {
    expect(!names.includes(forbidden), `there is no tool ${forbidden}`);
  }
  const error = byId(3)?.result?.structuredContent?.error;
  expect(byId(3)?.result?.isError === true && error?.code === 'mcp_disabled', 'a call says mcp_disabled');
  expect(/not running|switched off/.test(error?.message ?? ''), `with a clear text: "${error?.message}"`);
  expect(byId(4)?.result?.structuredContent?.error?.code === 'mcp_disabled', 'so does a call of a tool that does not exist');
  expect(!existsSync(join(dir, 'nobody-listens.sock')), 'the bridge created no socket');
  rmSync(dir, { recursive: true, force: true });
  console.log('MCP bridge: ok');
});
