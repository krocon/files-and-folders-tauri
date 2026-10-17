import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { isNavigableDir } from '../../core/fs/fs.models';
import { FileBrowserStore } from './file-browser.store';
import { FileTable } from './file-table/file-table';

/** One file panel: path bar, file table and status line. */
@Component({
  selector: 'app-file-browser',
  imports: [FileTable],
  providers: [FileBrowserStore],
  templateUrl: './file-browser.html',
  styleUrl: './file-browser.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileBrowser implements OnInit {
  protected readonly store = inject(FileBrowserStore);

  protected readonly errorText = computed(() => {
    const err = this.store.error();
    return err ? describeFsError(err) : null;
  });

  protected readonly status = computed(() => {
    const entries = this.store.entries();
    const dirs = entries.filter((e) => isNavigableDir(e)).length;
    const files = entries.length - dirs;
    const unreadable = this.store.listing()?.unreadableEntries ?? 0;
    const base = `${dirs} folder${dirs === 1 ? '' : 's'}, ${files} other item${files === 1 ? '' : 's'}`;
    return unreadable > 0 ? `${base} · ${unreadable} unreadable` : base;
  });

  ngOnInit(): void {
    void this.store.load();
  }
}
