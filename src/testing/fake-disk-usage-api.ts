import { DiskUsageApi } from '../app/core/diskusage/disk-usage-api';
import {
  DiskUsageView,
  SizeMode,
  UsageFile,
  UsageKind,
  UsageNode,
} from '../app/core/diskusage/disk-usage.models';

/** A node of a fake scan: folders have `children`, files a `size`. */
export interface FakeNode {
  readonly name: string;
  readonly size?: number;
  readonly kind?: UsageKind;
  readonly children?: readonly FakeNode[];
}

interface Stored {
  id: number;
  name: string;
  path: string | null;
  kind: UsageKind;
  size: number;
  parent: number;
  children: number[];
  removed: boolean;
}

/**
 * In-memory DiskUsageApi: `addScan(id, root, tree)` stores a tree (sizes: allocated =
 * logical); paths are built with `/`. Calls are recorded; `exists` decides what
 * `prune` removes (default: nothing exists any more).
 */
export class FakeDiskUsageApi extends DiskUsageApi {
  readonly scans = new Map<string, { nodes: Stored[]; running: boolean; version: number }>();
  readonly calls: string[] = [];
  readonly released: string[] = [];
  exists: (path: string) => boolean = () => false;
  sizeMode: SizeMode = 'allocated';

  addScan(scanId: string, root: string, tree: FakeNode, running = false): void {
    const nodes: Stored[] = [];
    const add = (n: FakeNode, path: string | null, parent: number): number => {
      const id = nodes.length;
      const kind: UsageKind = n.kind ?? (n.children ? 'dir' : 'file');
      nodes.push({
        id,
        name: n.name,
        path,
        kind,
        size: n.size ?? 0,
        parent,
        children: [],
        removed: false,
      });
      for (const c of n.children ?? []) {
        const childId = add(c, path === null ? null : `${path}/${c.name}`, id);
        nodes[id].children.push(childId);
      }
      return id;
    };
    add(tree, root, 0);
    this.scans.set(scanId, { nodes, running, version: 1 });
  }

  setRunning(scanId: string, running: boolean): void {
    const s = this.scans.get(scanId);
    if (s) {
      s.running = running;
      s.version++;
    }
  }

  private chain(nodes: Stored[], id: number): number[] {
    const out: number[] = [];
    for (let c = id; ; c = nodes[c].parent) {
      out.unshift(c);
      if (c === 0) {
        return out;
      }
    }
  }

  private scan(scanId: string) {
    const s = this.scans.get(scanId);
    if (!s) {
      throw { code: 'scan_not_found', message: 'gone', path: null };
    }
    return s;
  }

  private total(nodes: Stored[], id: number): { size: number; files: number; dirs: number } {
    const n = nodes[id];
    if (n.kind !== 'dir') {
      return { size: n.size, files: n.kind === 'file' || n.kind === 'link' ? 1 : 0, dirs: 0 };
    }
    let size = 0;
    let files = 0;
    let dirs = 0;
    for (const c of n.children.filter((c) => !nodes[c].removed)) {
      const t = this.total(nodes, c);
      size += t.size;
      files += t.files;
      dirs += t.dirs + (nodes[c].kind === 'dir' ? 1 : 0);
    }
    return { size, files, dirs };
  }

  private node(nodes: Stored[], id: number, depth: number): UsageNode {
    const n = nodes[id];
    const t = this.total(nodes, id);
    const kids = n.children
      .filter((c) => !nodes[c].removed)
      .sort((a, b) => this.total(nodes, b).size - this.total(nodes, a).size);
    return {
      id,
      name: n.name,
      path: n.path,
      kind: n.kind,
      allocated: t.size,
      logical: t.size,
      files: t.files,
      dirs: t.dirs,
      unreadable: 0,
      modifiedMs: 1_000,
      lossyName: false,
      ...(depth > 0 && n.kind === 'dir'
        ? { children: kids.map((c) => this.node(nodes, c, depth - 1)) }
        : {}),
    };
  }

  view(scanId: string, nodeId: number | null, depth: number): Promise<DiskUsageView> {
    this.calls.push(`view ${scanId} ${nodeId} ${depth}`);
    try {
      const s = this.scan(scanId);
      const id = nodeId ?? 0;
      if (!s.nodes[id] || s.nodes[id].removed) {
        throw { code: 'scan_not_found', message: 'gone', path: null };
      }
      const crumbs = [];
      for (let c = id; ; c = s.nodes[c].parent) {
        crumbs.unshift({ id: c, name: s.nodes[c].name });
        if (c === 0) {
          break;
        }
      }
      return Promise.resolve({
        node: this.node(s.nodes, id, depth),
        crumbs,
        virtualTop: s.nodes[0].path === null,
        running: s.running,
        complete: !s.running,
        simplified: false,
        scannedAtMs: 0,
        version: s.version,
        sizeMode: this.sizeMode,
        volume: null,
        scannedAllocated: this.total(s.nodes, 0).size,
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  largest(scanId: string, nodeId: number, limit: number): Promise<readonly UsageFile[]> {
    this.calls.push(`largest ${scanId} ${nodeId}`);
    const s = this.scan(scanId);
    const out: UsageFile[] = [];
    const walk = (id: number, dir: string) => {
      for (const c of s.nodes[id].children) {
        const n = s.nodes[c];
        if (n.removed) {
          continue;
        }
        if (n.kind === 'dir') {
          walk(c, dir ? `${dir}/${n.name}` : n.name);
        } else if (n.kind === 'file') {
          out.push({
            id: c,
            name: n.name,
            path: n.path ?? '',
            dir,
            dirId: id,
            ancestors: this.chain(s.nodes, id),
            allocated: n.size,
            logical: n.size,
            modifiedMs: 1_000,
            lossyName: false,
          });
        }
      }
    };
    walk(nodeId, '');
    return Promise.resolve(out.sort((a, b) => b.allocated - a.allocated).slice(0, limit));
  }

  locate(scanId: string, path: string): Promise<number | null> {
    const s = this.scan(scanId);
    return Promise.resolve(s.nodes.find((n) => n.path === path && !n.removed)?.id ?? null);
  }

  prune(scanId: string, paths: readonly string[]): Promise<readonly string[]> {
    this.calls.push(`prune ${scanId} ${paths.join(',')}`);
    const s = this.scan(scanId);
    const went: string[] = [];
    for (const p of paths) {
      const n = s.nodes.find((x) => x.path === p && !x.removed);
      if (n && !this.exists(p)) {
        n.removed = true;
        went.push(p);
      }
    }
    s.version++;
    return Promise.resolve(went);
  }

  release(scanId: string): Promise<void> {
    this.released.push(scanId);
    this.scans.delete(scanId);
    return Promise.resolve();
  }
}
