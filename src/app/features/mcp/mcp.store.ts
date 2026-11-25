import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { isNavigableDir } from '../../core/fs/fs.models';
import { McpApi } from '../../core/mcp/mcp-api';
import { McpStatusService } from '../../core/mcp/mcp-status.service';
import {
  McpEvent,
  McpPanel,
  McpReplyCode,
  McpTab,
  McpTabKind,
  McpUiReply,
  McpUiRequest,
  McpUiState,
  PairDecision,
} from '../../core/mcp/mcp.models';
import { ProposalDialog, ProposalService } from '../../core/mcp/proposal.service';
import { Side } from '../../core/session/session.models';
import { SettingsStore } from '../../core/settings/settings.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { isUsageChartKey, isUsageKey } from '../diskusage/usage-rows';
import { ImageOverviewStore } from '../imageoverview/image-overview.store';
import { MultiMkdirStore } from '../multimkdir/multimkdir.store';
import { MultiRenameStore } from '../multirename/multirename.store';
import { OpsStore } from '../ops/ops.store';
import { QuickViewStore } from '../preview/quick-view.store';
import { SearchStore } from '../search/search.store';
import { MAX_TABS, TabState, WorkspaceStore } from '../workspace/workspace.store';
import {
  EMPTY_PANEL,
  entriesInPanel,
  panelState,
  PUBLISH_DEBOUNCE_MS,
  tabKind,
  withClient,
} from './mcp-logic';

export interface PairingRequest {
  readonly id: number;
  readonly client: string;
}

/**
 * The window's side of the MCP interface (design 071). While `mcp.enabled` is on it
 * reports the panels to Rust (debounced) and serves Rust's requests by the stores and
 * dialogs the keyboard uses too – there is no second way to an operation:
 *
 * - view requests (navigate, mark …) are refused with `busy` while a dialog is open;
 * - a proposal opens the normal dialog (`OpsStore`, `MultiRenameStore`,
 *   `MultiMkdirStore`) marked as a proposal; the answer is how the user closed it;
 * - the pairing question waits until no dialog is open.
 *
 * The settings are never sent to Rust: it reads `settings.json` itself after `sync`.
 */
@Injectable({ providedIn: 'root' })
export class McpStore {
  private readonly api = inject(McpApi);
  private readonly ws = inject(WorkspaceStore);
  private readonly settings = inject(SettingsStore);
  private readonly dialogs = inject(DialogService);
  private readonly ops = inject(OpsStore);
  private readonly mr = inject(MultiRenameStore);
  private readonly mm = inject(MultiMkdirStore);
  private readonly search = inject(SearchStore);
  private readonly quick = inject(QuickViewStore);
  private readonly overview = inject(ImageOverviewStore);
  private readonly proposals = inject(ProposalService);
  private readonly statusService = inject(McpStatusService);

  readonly status = this.statusService.status;
  /** The pairing question shown right now. */
  readonly pairing = signal<PairingRequest | null>(null);
  /** Questions that wait for the window to be free. */
  private readonly pairQueue = signal<readonly PairingRequest[]>([]);
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: McpUiState | null = null;
  private subscribed = false;
  private lastSync: string | null = null;
  debounceMs = PUBLISH_DEBOUNCE_MS;

  constructor() {
    // the `mcp.*` settings changed: Rust reads the file again once it is written
    effect(() => {
      if (!this.settings.loaded()) {
        return;
      }
      const key = JSON.stringify([
        this.settings.get('mcp.enabled'),
        this.settings.get('mcp.allowContent'),
        this.settings.get('mcp.roots'),
        this.settings.get('mcp.clients'),
      ]);
      untracked(() => void this.syncSettings(key));
    });
    // the mirror of the window – only while MCP is on
    effect(() => {
      if (!this.settings.loaded() || !this.settings.get('mcp.enabled') || !this.ws.ready()) {
        return;
      }
      const state: McpUiState = {
        activeSide: this.ws.activeSide(),
        left: this.panelOf('left'),
        right: this.panelOf('right'),
      };
      untracked(() => this.schedulePublish(state));
    });
    // the next pairing question, once no dialog is open
    effect(() => {
      const next = this.pairQueue()[0];
      if (next && this.dialogs.open() === null && this.pairing() === null) {
        untracked(() => {
          this.pairQueue.update((q) => q.slice(1));
          this.pairing.set(next);
          this.dialogs.show('mcp-pairing');
        });
      }
    });
    // a proposal's dialog was replaced by another one without closing: it is over
    effect(() => {
      const proposal = this.proposals.current();
      const open = this.dialogs.open();
      if (proposal && open !== proposal.dialog) {
        untracked(() => this.proposals.abandon());
      }
    });
    // the pairing dialog went away without an answer (Esc is "deny"; anything else too)
    effect(() => {
      const pairing = this.pairing();
      if (pairing && this.dialogs.open() !== 'mcp-pairing') {
        untracked(() => this.decide('deny'));
      }
    });
  }

  /** Subscribes to Rust's requests (once). */
  async init(): Promise<void> {
    if (this.subscribed) {
      return;
    }
    this.subscribed = true;
    try {
      this.status.set(await this.api.subscribe((e) => this.onEvent(e)));
    } catch {
      this.subscribed = false; // no backend: MCP stays off
    }
  }

  private async syncSettings(key: string): Promise<void> {
    if (key === this.lastSync) {
      return;
    }
    this.lastSync = key;
    try {
      await this.settings.flush();
      this.status.set(await this.api.sync());
    } catch {
      // no backend
    }
  }

  // ---- the mirror ----

  private kindOf(tab: TabState): McpTabKind {
    return tabKind(tab.search, (key) =>
      isUsageKey(key)
        ? 'usage'
        : isUsageChartKey(key)
          ? 'chart'
          : this.search.result(key)?.kind === 'duplicates'
            ? 'duplicates'
            : 'search',
    );
  }

  private panelOf(side: Side): McpPanel {
    const panel = this.ws.panels()[side];
    const tabs: McpTab[] = panel.tabs.map((t) => ({
      id: t.id,
      kind: this.kindOf(t),
      title: t.title,
      // a result tab has no folder of its own (its `path` is only where it falls back to)
      path: t.search ? null : t.path,
    }));
    const store = this.ws.panel(side)?.store;
    if (!store) {
      return { ...EMPTY_PANEL, tabs, activeTab: panel.activeTab };
    }
    return panelState({
      tabs,
      activeTab: panel.activeTab,
      folder: store.path(),
      cursor: store.cursorEntry(),
      marked: store.markedEntries(),
      unchecked: store.cachedAt() !== null,
    });
  }

  private schedulePublish(state: McpUiState): void {
    this.pending = state;
    if (this.publishTimer !== null) {
      return;
    }
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      const next = this.pending;
      this.pending = null;
      if (next && this.settings.get('mcp.enabled')) {
        void this.api.publishState(next).catch(() => undefined);
      }
    }, this.debounceMs);
  }

  // ---- events from Rust ----

  private onEvent(event: McpEvent): void {
    switch (event.type) {
      case 'status':
        this.status.set(event.status);
        break;
      case 'withdraw':
        this.withdraw(event.id);
        break;
      case 'request':
        void this.onRequest(event.id, event.request);
        break;
    }
  }

  private reply(id: number, reply: McpUiReply): void {
    void this.api.reply(id, reply).catch(() => undefined);
  }

  private refuse(id: number, code: McpReplyCode): void {
    this.reply(id, { ok: false, code });
  }

  /** The request is over in Rust (time limit, the client gave up, disconnected). */
  private withdraw(id: number): void {
    this.pairQueue.update((q) => q.filter((p) => p.id !== id));
    if (this.pairing()?.id === id) {
      this.pairing.set(null);
      if (this.dialogs.open() === 'mcp-pairing') {
        this.dialogs.close();
      }
    }
    const proposal = this.proposals.current();
    if (proposal?.id === id && this.dialogs.open() === proposal.dialog) {
      this.closeProposal(proposal.dialog);
    }
  }

  private closeProposal(dialog: ProposalDialog): void {
    switch (dialog) {
      case 'copy-move':
      case 'delete':
        this.ops.close();
        break;
      case 'multi-rename':
        this.mr.close();
        break;
      case 'multi-mkdir':
        this.mm.close();
        break;
    }
  }

  private async onRequest(id: number, request: McpUiRequest): Promise<void> {
    if (!this.settings.get('mcp.enabled')) {
      this.refuse(id, 'not_available');
      return;
    }
    if (request.kind === 'pair') {
      this.pairQueue.update((q) => [...q, { id, client: request.client }]);
      return;
    }
    // a dialog is open, or the image overview covers the panels: the window is the
    // user's now (E9) – nothing changes behind it and no dialog replaces it
    if (this.dialogs.open() !== null || this.overview.isOpen() || !this.ws.ready()) {
      this.refuse(id, 'busy');
      return;
    }
    try {
      switch (request.kind) {
        case 'navigate':
          this.ws.requestNavigate(request.side, request.path);
          this.reply(id, { ok: true });
          break;
        case 'openTab':
          this.openTab(id, request);
          break;
        case 'setCursor':
          this.reply(
            id,
            this.setCursor(request.side, request.path)
              ? { ok: true }
              : { ok: false, code: 'not_found' },
          );
          break;
        case 'mark':
          this.mark(id, request);
          break;
        case 'quickView':
          if (!this.setCursor(request.side, request.path)) {
            this.refuse(id, 'not_found');
            break;
          }
          this.ws.setActive(request.side);
          if (!this.quick.on()) {
            this.quick.toggle();
          }
          this.reply(id, { ok: true });
          break;
        case 'showResults': {
          const error = this.search.showFixed(
            request.title,
            request.hits,
            request.roots,
            request.side,
            null,
          );
          this.reply(id, error ? { ok: false, code: 'limit_exceeded' } : { ok: true });
          break;
        }
        case 'proposeCopy':
        case 'proposeMove':
          await this.ops.openCopyMoveFor({
            kind: request.kind === 'proposeMove' ? 'move' : 'copy',
            side: this.ws.activeSide(),
            sourceDir: request.sourceDir,
            sources: request.entries,
            target: request.target,
            proposedBy: request.client,
          });
          this.await(id, request.client, 'copy-move');
          break;
        case 'proposeDelete':
          await this.ops.openDeleteFor({
            side: this.ws.activeSide(),
            sourceDir: request.sourceDir,
            entries: request.entries,
            proposedBy: request.client,
          });
          this.await(id, request.client, 'delete');
          break;
        case 'proposeRename':
          this.mr.openFixed({
            side: this.ws.activeSide(),
            folder: request.folder,
            pairs: request.pairs.map((p) => ({
              source: {
                path: p.entry.path,
                name: p.entry.name,
                isDir: isNavigableDir(p.entry),
                modifiedMs: p.entry.modifiedMs,
                parents: p.parentNames,
              },
              newName: p.newName,
            })),
            proposedBy: request.client,
          });
          this.await(id, request.client, 'multi-rename');
          break;
        case 'proposeMkdir':
          this.mm.openFixed({
            side: this.ws.activeSide(),
            parent: request.parent,
            parents: request.parentNames,
            names: request.names,
            proposedBy: request.client,
          });
          this.await(id, request.client, 'multi-mkdir');
          break;
      }
    } catch {
      // a store refused (inside an archive, nothing to do …)
      this.refuse(id, 'not_available');
    }
  }

  /** The proposal's dialog is open: answer when the user confirmed or closed it. */
  private await(id: number, client: string, dialog: ProposalDialog): void {
    if (this.dialogs.open() !== dialog) {
      // a dialog opened in between (the stores await Rust): never replace or adopt it
      this.refuse(id, 'busy');
      return;
    }
    void this.proposals.begin({ id, client, dialog }).then((result) => {
      this.reply(
        id,
        result.outcome === 'confirmed'
          ? { ok: true, outcome: 'confirmed', jobId: result.jobId }
          : { ok: true, outcome: 'cancelled' },
      );
    });
  }

  private openTab(id: number, request: Extract<McpUiRequest, { kind: 'openTab' }>): void {
    const before = this.ws.panels()[request.side];
    if (before.tabs.length >= MAX_TABS) {
      this.refuse(id, 'limit_exceeded');
      return;
    }
    this.ws.openInNewTab(request.side, request.path, request.title);
    if (!request.activate) {
      this.ws.selectTab(request.side, before.activeTab);
    }
    this.reply(id, { ok: true });
  }

  /** Puts the cursor on an entry the panel lists; false if it does not. */
  private setCursor(side: Side, path: string): boolean {
    const panel = this.ws.panel(side);
    if (!panel || entriesInPanel([path], panel.store.entries()).length === 0) {
      return false;
    }
    panel.store.setCursor(path);
    panel.controller()?.restoreCursor();
    return true;
  }

  private mark(id: number, request: Extract<McpUiRequest, { kind: 'mark' }>): void {
    const store = this.ws.panel(request.side)?.store;
    if (!store) {
      this.refuse(id, 'not_available');
      return;
    }
    // only entries the panel lists – and marking changes no file
    const paths = entriesInPanel(request.paths, store.entries()).filter(
      (p) => !store.isUnmarkable(p),
    );
    if (paths.length === 0 && request.paths.length > 0) {
      this.refuse(id, 'not_found');
      return;
    }
    if (request.mode === 'replace') {
      store.clearMarks();
    }
    store.setMarked(paths, request.mode !== 'remove');
    this.reply(id, { ok: true });
  }

  // ---- pairing, log, disconnect ----

  /** The user's answer to the pairing question; "always" is kept in `mcp.clients`. */
  decide(decision: PairDecision): void {
    const pairing = this.pairing();
    if (!pairing) {
      return;
    }
    this.pairing.set(null);
    if (decision === 'always') {
      this.settings.set(
        'mcp.clients',
        withClient(this.settings.get('mcp.clients'), pairing.client),
      );
    }
    this.reply(pairing.id, { ok: true, decision });
    if (this.dialogs.open() === 'mcp-pairing') {
      this.dialogs.close();
    }
  }

  showLog(): void {
    void this.refresh();
    this.dialogs.show('mcp-log');
  }

  async refresh(): Promise<void> {
    try {
      this.status.set(await this.api.status());
    } catch {
      // no backend
    }
  }

  /** "Disconnect": one connection or all – works at once. */
  async disconnect(connection: number | null): Promise<void> {
    try {
      await this.api.disconnect(connection);
    } catch {
      // no backend
    }
    await this.refresh();
  }

  /** Takes a name off the "always" list (settings); its connections end with the next sync. */
  revoke(name: string): void {
    this.settings.set(
      'mcp.clients',
      this.settings.get('mcp.clients').filter((n) => n !== name),
    );
  }
}
