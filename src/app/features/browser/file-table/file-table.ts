import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { DirEntry, isNavigableDir } from '../../../core/fs/fs.models';
import { formatModified, formatSize } from '../../../shared/format';

interface Row {
  readonly entry: DirEntry;
  readonly id: string;
  readonly icon: string;
  readonly typeLabel: string;
  readonly size: string;
  readonly modified: string;
}

/** Presentational, keyboard-operable file list. */
@Component({
  selector: 'app-file-table',
  templateUrl: './file-table.html',
  styleUrl: './file-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTable {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly entries = input.required<readonly DirEntry[]>();
  readonly selectedPath = input<string | null>(null);
  readonly loading = input(false);
  readonly label = input('Folder contents');

  readonly selectEntry = output<DirEntry>();
  readonly openEntry = output<DirEntry>();
  readonly moveSelection = output<number>();
  readonly selectEdge = output<'first' | 'last'>();
  readonly goUp = output<void>();

  protected readonly rows = computed<Row[]>(() =>
    this.entries().map((entry, i) => ({
      entry,
      id: `fnf-row-${i}`,
      icon: iconFor(entry),
      typeLabel: typeLabelFor(entry),
      size: formatSize(entry.size),
      modified: formatModified(entry.modifiedMs),
    })),
  );

  protected readonly activeRowId = computed(() => {
    const sel = this.selectedPath();
    return this.rows().find((r) => r.entry.path === sel)?.id ?? null;
  });

  constructor() {
    effect(() => {
      const id = this.activeRowId();
      if (id === null) {
        return;
      }
      const row = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
      row?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const pageStep = 10;
    switch (event.key) {
      case 'ArrowDown':
        this.moveSelection.emit(1);
        break;
      case 'ArrowUp':
        this.moveSelection.emit(-1);
        break;
      case 'PageDown':
        this.moveSelection.emit(pageStep);
        break;
      case 'PageUp':
        this.moveSelection.emit(-pageStep);
        break;
      case 'Home':
        this.selectEdge.emit('first');
        break;
      case 'End':
        this.selectEdge.emit('last');
        break;
      case 'Enter': {
        const entry = this.entries().find((e) => e.path === this.selectedPath());
        if (entry) {
          this.openEntry.emit(entry);
        }
        break;
      }
      case 'Backspace':
        this.goUp.emit();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}

function iconFor(entry: DirEntry): string {
  if (isNavigableDir(entry)) {
    return entry.kind === 'symlink' ? '📁↗' : '📁';
  }
  switch (entry.kind) {
    case 'symlink':
      return '📄↗';
    case 'unknown':
      return '⚠';
    default:
      return '📄';
  }
}

function typeLabelFor(entry: DirEntry): string {
  switch (entry.kind) {
    case 'directory':
      return 'Folder';
    case 'file': {
      const dot = entry.name.lastIndexOf('.');
      return dot > 0 && dot < entry.name.length - 1
        ? entry.name.slice(dot + 1).toUpperCase()
        : 'File';
    }
    case 'symlink':
      return entry.targetKind === null ? 'Broken link' : 'Link';
    case 'unknown':
      return 'Unreadable';
  }
}
