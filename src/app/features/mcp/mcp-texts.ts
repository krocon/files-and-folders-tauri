import { translatable } from '../../core/i18n/i18n';
import { MCP_DE } from './mcp-texts.de';

/** Texts of the MCP interface (071); German in `mcp-texts.de.ts`. */
export const MCP_EN = {
  // pairing
  pairTitle: 'Access over MCP',
  pairQuestion: (client: string) => `“${client}” wants to work with Files and Folders.`,
  pairWhat:
    'It may see the open folders, tabs and marked files, search and compare inside the allowed folders, steer the view and propose file operations. Nothing is copied, moved, renamed or deleted without your confirmation in this window.',
  pairName:
    'The name comes from the program itself and cannot be verified. Deny if you did not start it.',
  pairContentOn: 'File contents may be read (Settings → MCP).',
  pairContentOff: 'File contents are not readable (Settings → MCP).',
  deny: 'Deny',
  once: 'Allow once',
  always: 'Always allow',
  // indicator and log
  indicator: (client: string) => `MCP: ${client}`,
  indicatorMany: (n: number) => `MCP: ${n} clients`,
  indicatorTitle: (clients: string) => `Connected over MCP: ${clients} – click for the log`,
  logTitle: 'MCP',
  off: 'MCP is switched off. Nothing listens. Switch it on under Settings → MCP.',
  listening: 'MCP is on. Only programs of your user account on this computer can connect.',
  notListening: (reason: string) => `MCP is on but does not listen: ${reason}`,
  reasons: {
    unsupported: 'not available on this platform yet.',
    in_use: 'another running Files and Folders already serves MCP.',
    socket_path_too_long: 'the path of the socket is too long for this system.',
    io: 'the socket could not be created.',
    not_available: 'the home folder is unknown.',
  } as Readonly<Record<string, string>>,
  unknownReason: 'unknown reason.',
  clients: 'Connected',
  noClients: 'No client is connected.',
  since: (time: string) => `since ${time}`,
  calls: (n: number) => (n === 1 ? '1 call' : `${n} calls`),
  notPaired: 'not allowed yet',
  disconnect: 'Disconnect',
  disconnectAll: 'Disconnect all',
  log: 'Calls of this session',
  logNote: 'Kept in memory only – without paths, names or contents.',
  noCalls: 'No calls yet.',
  colTime: 'Time',
  colClient: 'Client',
  colTool: 'Tool',
  colCount: 'Items',
  colOutcome: 'Result',
  close: 'Close',
  // proposals
  proposalFrom: (client: string) => `Proposal from “${client}”.`,
  proposalCheck: 'Check it before you confirm – nothing happens until you do.',
  proposalKeys: 'Confirm with a click or Ctrl/⌘+Enter; Enter alone does nothing here.',
  proposalLocked: 'Look at the proposal first.',
  allEntries: (n: number) => (n === 1 ? '1 entry:' : `All ${n} entries:`),
  renameList: 'The names are given by the proposal; the rules do not apply.',
  mkdirList: 'The names are given by the proposal.',
};

export const MCP_TEXTS = translatable('mcp', MCP_EN, { de: MCP_DE });
