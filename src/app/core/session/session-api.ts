import { Injectable } from '@angular/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { toFsError } from '../fs/fs-error';
import { LoadedSession, Session } from './session.models';

/** Typed facade for the session commands (tests use `FakeSessionApi`). */
export abstract class SessionApi {
  abstract load(): Promise<LoadedSession>;
  /** Rejects with an `FsError`. */
  abstract save(session: Session): Promise<void>;
}

@Injectable()
export class TauriSessionApi extends SessionApi {
  async load(): Promise<LoadedSession> {
    if (!isTauri()) {
      // plain browser (`pnpm start`): start with defaults
      return { session: defaultSession(), warning: null, adjusted: [] };
    }
    try {
      return await invoke<LoadedSession>('load_session');
    } catch (err) {
      throw toFsError(err);
    }
  }

  async save(session: Session): Promise<void> {
    if (!isTauri()) {
      return;
    }
    try {
      await invoke<void>('save_session', { session });
    } catch (err) {
      throw toFsError(err);
    }
  }
}

export function defaultSession(): Session {
  const tab = (id: string) => ({
    id,
    path: null,
    title: '',
    history: [],
    cursor: null,
    hiddenVisible: false,
    filterActive: false,
    filterText: '',
    table: null,
  });
  return {
    version: 1,
    activeSide: 'left',
    splitter: 0.5,
    favorites: [],
    panels: {
      left: { activeTab: 0, tabs: [tab('t1')] },
      right: { activeTab: 0, tabs: [tab('t2')] },
    },
  };
}
