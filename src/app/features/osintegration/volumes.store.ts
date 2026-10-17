import { inject, Injectable, signal } from '@angular/core';
import { OsApi } from '../../core/os/os-api';
import { Volume } from '../../core/os/os.models';

/** The drives for the folder menus of both panels (design 011 E1). Root. */
@Injectable({ providedIn: 'root' })
export class VolumesStore {
  private readonly api = inject(OsApi);
  /** `null` while the drives are being read. */
  readonly volumes = signal<readonly Volume[] | null>(null);
  private seq = 0;

  /** Reads the drives; an older answer that arrives late is dropped. */
  async refresh(): Promise<void> {
    const seq = ++this.seq;
    this.volumes.set(null);
    let list: readonly Volume[];
    try {
      list = await this.api.listVolumes();
    } catch {
      list = [];
    }
    if (seq === this.seq) {
      this.volumes.set(list);
    }
  }
}
