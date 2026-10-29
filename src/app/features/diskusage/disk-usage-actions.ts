import { ActionId } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { errorText } from '../../core/fs/fs-error';
import { DirEntry, isNavigableDir, isParentRow } from '../../core/fs/fs.models';
import { JobsStore } from '../../core/jobs/jobs.store';
import { SettingsStore } from '../../core/settings/settings.store';
import { WorkspaceStore } from '../workspace/workspace.store';
import { DiskUsageStore } from './disk-usage.store';
import { USAGE_TEXTS } from './disk-usage-texts';
import { isUsageKey, scanIdOf } from './usage-rows';

/**
 * Off in a disk-usage tab (design 033 E8): what needs a real folder or changes
 * names – deleting, copying, moving, viewing stay.
 */
export const OFF_IN_USAGE: ReadonlySet<ActionId> = new Set<ActionId>([
  'OPEN_CREATE_FILE_DLG',
  'OPEN_MKDIR_DLG',
  'OPEN_RENAME_DLG',
  'RENAME_INLINE',
  'OPEN_LINK_DLG',
  'OPEN_MULTIRENAME_DLG',
  'OPEN_MULTIMKDIR_DLG',
  'OPEN_GROUPFILES_DLG',
  'OPEN_SERIES_GROUP_DLG',
  'OPEN_DELETE_EMPTY_FOLDERS_DLG',
  'OPEN_CHANGE_ATTRIBUTES_DLG',
  'CALC_DIR_SIZES',
  'OPEN_DISK_USAGE',
  'OPEN_DISK_USAGE_VOLUME',
]);

/** What a scan of the active panel starts with: roots and the tab's name. */
export interface UsageStart {
  readonly roots: readonly string[];
  readonly name: string;
  readonly filesIgnored: boolean;
}

/**
 * Marked folders; without marks the folder under the cursor; on ".." or a file the
 * shown folder (design 033 E8). `null`: nothing to scan.
 */
export function usageStart(
  marked: readonly DirEntry[],
  cursor: DirEntry | null,
  folder: string | null,
  folderName: string,
  selectionName: string,
): UsageStart | null {
  const real = marked.filter((e) => !isParentRow(e));
  if (real.length > 0) {
    const dirs = real.filter((e) => isNavigableDir(e) && e.kind !== 'symlink');
    if (dirs.length === 0) {
      return folder ? { roots: [folder], name: folderName, filesIgnored: true } : null;
    }
    return {
      roots: dirs.map((e) => e.path),
      name: dirs.length === 1 ? dirs[0].name : selectionName,
      filesIgnored: dirs.length < real.length,
    };
  }
  if (cursor && !isParentRow(cursor) && isNavigableDir(cursor) && cursor.kind !== 'symlink') {
    return { roots: [cursor.path], name: cursor.name, filesIgnored: false };
  }
  return folder ? { roots: [folder], name: folderName, filesIgnored: false } : null;
}

export function registerDiskUsageActions(
  actions: ActionService,
  ws: WorkspaceStore,
  usage: DiskUsageStore,
  jobs: JobsStore,
  settings: SettingsStore,
): () => void {
  const store = () => ws.panel()?.store;
  const scanId = () => {
    const key = store()?.searchKey();
    return isUsageKey(key) ? scanIdOf(key) : null;
  };
  /** A real folder is shown (no result tab, not inside an archive). */
  const realFolder = () => {
    const s = store();
    return !!s && s.searchKey() === null && s.archive() === null && s.path() !== null;
  };
  const report = (err: Awaited<ReturnType<DiskUsageStore['start']>>) => {
    if (err) {
      jobs.report(errorText(err));
    }
  };
  const hints = () => {
    if (store()?.listing()?.network) {
      jobs.report(USAGE_TEXTS.network);
    }
  };
  const unveto = actions.setVeto((id) =>
    id !== null && OFF_IN_USAGE.has(id) && scanId() !== null ? USAGE_TEXTS.notHere : null,
  );
  const unregister = actions.register({
    OPEN_DISK_USAGE: {
      enabled: realFolder,
      run: async () => {
        const s = store();
        if (!s) {
          return;
        }
        const start = usageStart(
          s.markedEntries(),
          s.cursorEntry(),
          s.path(),
          s.listing()?.segments.at(-1)?.name ?? '',
          USAGE_TEXTS.selection,
        );
        if (!start) {
          jobs.report(USAGE_TEXTS.noFolder);
          return;
        }
        if (start.filesIgnored) {
          jobs.report(USAGE_TEXTS.filesIgnored);
        }
        hints();
        report(await usage.start(ws.activeSide(), start.roots, start.name));
      },
    },
    OPEN_DISK_USAGE_VOLUME: {
      enabled: realFolder,
      run: async () => {
        const path = store()?.path();
        if (path) {
          hints();
          report(await usage.start(ws.activeSide(), [path], '', true));
        }
      },
    },
    DISK_USAGE_TOGGLE_CHART: {
      enabled: () => scanId() !== null,
      run: () =>
        settings.set(
          'diskUsage.chart',
          settings.get('diskUsage.chart') === 'sunburst' ? 'treemap' : 'sunburst',
        ),
    },
    DISK_USAGE_LARGEST: {
      enabled: () => scanId() !== null,
      run: async () => {
        const id = scanId();
        if (id) {
          await usage.setMode(id, usage.state(id)?.mode === 'largest' ? 'all' : 'largest');
        }
      },
    },
  });
  return () => {
    unregister();
    unveto();
  };
}
