import { Injectable } from '@angular/core';
import { FsError } from '../fs/fs.models';

/** Errors that a (re)connect may cure (design 034 §4.3). */
export function isNotConnected(error: FsError | null | undefined): boolean {
  return error?.code === 'remote_not_connected' || error?.code === 'remote_connection_lost';
}

/**
 * Bridge from the panels (a server folder that is not connected) to the connection
 * feature: the panels need not know it (like the archive password prompt of 025).
 */
@Injectable({ providedIn: 'root' })
export class RemoteConnectPrompt {
  private handler: ((profileId: string, retry: () => unknown) => void) | null = null;

  setHandler(handler: (profileId: string, retry: () => unknown) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = null;
      }
    };
  }

  /** Starts connecting `profileId`; `retry` runs once it is connected. False = no handler. */
  connect(profileId: string, retry: () => unknown): boolean {
    if (!this.handler) {
      return false;
    }
    this.handler(profileId, retry);
    return true;
  }
}

/** The profile id of a server path (`remote://<id>/…`) – only for the prompt above. */
export function profileOf(path: string): string | null {
  const m = /^remote:\/\/([a-z0-9-]{1,40})(?:\/|$)/.exec(path);
  return m ? m[1] : null;
}
