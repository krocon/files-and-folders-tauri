import { SessionApi, defaultSession } from '../app/core/session/session-api';
import { LoadedSession, Session } from '../app/core/session/session.models';

/** In-memory SessionApi: `loaded` is returned by `load`, every `save` is recorded. */
export class FakeSessionApi extends SessionApi {
  loaded: LoadedSession = { session: defaultSession(), warning: null, adjusted: [] };
  readonly saved: Session[] = [];
  failSave = false;

  load(): Promise<LoadedSession> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  save(session: Session): Promise<void> {
    if (this.failSave) {
      return Promise.reject({ code: 'io', message: 'disk full', path: null });
    }
    this.saved.push(structuredClone(session));
    return Promise.resolve();
  }
}
