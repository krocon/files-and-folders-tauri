import { MenuApi } from '../app/core/menu/menu-api';
import { NativeMenuEvent, NativeMenuSpec } from '../app/core/menu/menu.models';

export class FakeMenuApi extends MenuApi {
  /** What `setAppMenu` answers (true = native menu installed). */
  native = false;
  readonly specs: NativeMenuSpec[] = [];
  closed = 0;
  private listener: ((evt: NativeMenuEvent) => void) | null = null;

  setAppMenu(spec: NativeMenuSpec): Promise<boolean> {
    this.specs.push(structuredClone(spec));
    return Promise.resolve(this.native);
  }

  subscribe(onEvent: (evt: NativeMenuEvent) => void): Promise<void> {
    this.listener = onEvent;
    return Promise.resolve();
  }

  closeMainWindow(): Promise<void> {
    this.closed++;
    return Promise.resolve();
  }

  /** Simulates a click in the native menu. */
  emit(id: string): void {
    this.listener?.({ id });
  }
}
