import { AreaIdent, AreaModelIf, CellRendererIf, DomServiceIf } from '@guiexpert/table';

/**
 * In-place rename (F2, design 006 E3): a text input in the name cell with the
 * name **without its extension** selected. Enter commits, Escape or leaving
 * the field cancels. The table never writes the value (the model refuses it) –
 * `done` gets the typed name (or null) and Rust renames.
 *
 * The table rebuilds cells on repaints (hover, live updates): the typed text is
 * kept here as a draft and the new input gets the focus back.
 */
export class RenameEditor implements CellRendererIf {
  private draft: string | null = null;
  private caret: [number, number] | null = null;
  private finished = false;

  constructor(
    private readonly name: string,
    private readonly selectEnd: number,
    private readonly done: (value: string | null) => void,
  ) {}

  /** Ends the editing from outside (e.g. the folder was reloaded): cancels. */
  cancel(): void {
    this.finish(null);
  }

  render(
    cellDiv: HTMLDivElement,
    _rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    _areaModel: AreaModelIf,
    _cellValue: unknown,
    domService: DomServiceIf,
  ): undefined {
    if (this.finished) {
      return undefined;
    }
    const input = domService.createElement<HTMLInputElement>('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.className = 'fnf-rename-input';
    input.setAttribute('aria-label', `Rename ${this.name}`);
    input.value = this.draft ?? this.name;
    const [start, end] = this.caret ?? [0, this.selectEnd];
    input.addEventListener('input', () => {
      this.draft = input.value;
    });
    input.addEventListener('select', () => this.remember(input));
    input.addEventListener('keyup', () => this.remember(input));
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.isComposing) {
        evt.preventDefault();
        evt.stopPropagation();
        this.finish(input.value);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        this.finish(null);
      } else if (evt.key.length === 1 || evt.key === 'Backspace' || evt.key === 'Delete') {
        // typing belongs to the input – not to type-ahead or the table
        evt.stopPropagation();
      }
    });
    input.addEventListener('blur', () => {
      // a repaint removes the input (it gets a new one) – only a real focus loss cancels
      setTimeout(() => {
        if (input.isConnected && document.activeElement !== input) {
          this.finish(null);
        }
      });
    });
    cellDiv.textContent = '';
    cellDiv.appendChild(input);
    setTimeout(() => {
      if (!this.finished && input.isConnected) {
        input.focus();
        input.setSelectionRange(start, end);
      }
    });
    return undefined;
  }

  private remember(input: HTMLInputElement): void {
    this.caret = [input.selectionStart ?? 0, input.selectionEnd ?? 0];
  }

  private finish(value: string | null): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.done(value);
  }
}
