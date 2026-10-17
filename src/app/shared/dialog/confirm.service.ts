import { inject, Injectable, signal } from '@angular/core';
import { DialogService } from './dialog.service';

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly confirmLabel: string;
}

/** Asks a yes/no question in a modal; the default (Enter, Esc) is "cancel". */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialogs = inject(DialogService);
  private resolver: ((ok: boolean) => void) | null = null;
  readonly request = signal<ConfirmRequest | null>(null);

  ask(request: ConfirmRequest): Promise<boolean> {
    this.answer(false);
    this.request.set(request);
    this.dialogs.show('confirm');
    return new Promise<boolean>((resolve) => (this.resolver = resolve));
  }

  answer(ok: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    if (this.request() !== null) {
      this.request.set(null);
      if (this.dialogs.open() === 'confirm') {
        this.dialogs.close();
      }
    }
    resolve?.(ok);
  }
}
