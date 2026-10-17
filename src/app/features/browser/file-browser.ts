import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { describeFsError } from '../../core/fs/fs-error';
import { isNavigableDir } from '../../core/fs/fs.models';
import { FileBrowserStore } from './file-browser.store';
import { FileList } from './file-list/file-list';

let panelSeq = 0;

/** One file panel: path bar, file table and status line. */
@Component({
  selector: 'app-file-browser',
  imports: [FileList],
  providers: [FileBrowserStore],
  templateUrl: './file-browser.html',
  styleUrl: './file-browser.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileBrowser implements OnInit {
  protected readonly store = inject(FileBrowserStore);
  /** Unique per panel – names the file list (`aria-labelledby`). */
  protected readonly pathId = `fnf-path-${++panelSeq}`;

  protected readonly errorText = computed(() => {
    const err = this.store.error();
    return err ? describeFsError(err) : null;
  });

  protected readonly status = computed(() => {
    const entries = this.store.entries();
    const dirs = entries.filter((e) => isNavigableDir(e)).length;
    const files = entries.length - dirs;
    const unreadable = this.store.listing()?.unreadableEntries ?? 0;
    const marked = this.store.marked().size;
    let text = `${dirs} folder${dirs === 1 ? '' : 's'}, ${files} other item${files === 1 ? '' : 's'}`;
    if (marked > 0) {
      text += ` · ${marked} marked`;
    }
    if (unreadable > 0) {
      text += ` · ${unreadable} unreadable`;
    }
    return text;
  });

  ngOnInit(): void {
    void this.store.load();
  }
}
