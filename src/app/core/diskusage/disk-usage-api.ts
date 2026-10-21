import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { DiskUsageView, UsageFile } from './disk-usage.models';

/**
 * Facade for the disk-usage view (design 033, Rust `commands/disk_usage.rs`). Scans
 * start as job `diskUsage` (`JobsStore.start`). Rejects with an `FsError`
 * (`scan_not_found` once a scan was released).
 */
@Injectable({ providedIn: 'root', useFactory: () => new TauriDiskUsageApi() })
export abstract class DiskUsageApi {
  /** `nodeId` null = the top node; children down to `depth` levels. */
  abstract view(
    scanId: string,
    nodeId: number | null,
    depth: number,
    minFraction: number,
    limit: number,
  ): Promise<DiskUsageView>;
  abstract largest(scanId: string, nodeId: number, limit: number): Promise<readonly UsageFile[]>;
  abstract locate(scanId: string, path: string): Promise<number | null>;
  /** Removes the entries of `paths` that no longer exist; returns how many went. */
  abstract prune(scanId: string, paths: readonly string[]): Promise<number>;
  /** Forgets the scan (a running one is cancelled). */
  abstract release(scanId: string): Promise<void>;
}

@Injectable()
export class TauriDiskUsageApi extends DiskUsageApi {
  view(
    scanId: string,
    nodeId: number | null,
    depth: number,
    minFraction: number,
    limit: number,
  ): Promise<DiskUsageView> {
    return call('disk_usage_view', { scanId, nodeId, depth, minFraction, limit });
  }

  largest(scanId: string, nodeId: number, limit: number): Promise<readonly UsageFile[]> {
    return call('disk_usage_largest', { scanId, nodeId, limit });
  }

  locate(scanId: string, path: string): Promise<number | null> {
    return call('disk_usage_locate', { scanId, path });
  }

  prune(scanId: string, paths: readonly string[]): Promise<number> {
    return call('disk_usage_prune', { scanId, paths });
  }

  release(scanId: string): Promise<void> {
    return call('disk_usage_release', { scanId });
  }
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw toFsError({ code: 'no_backend', message: 'Tauri runtime not detected', path: null });
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toFsError(err);
  }
}
