import { Injectable } from '@angular/core';
import { FsError } from '../fs/fs.models';

/** A password is needed for `archive`; `retry` repeats what failed once it is known. */
export interface PasswordNeeded {
  /** The archive file (a real path). */
  readonly archive: string;
  /** A password was known but did not fit. */
  readonly wrong: boolean;
  readonly retry: () => unknown;
}

/** Password errors of design 025 E4. */
export function isPasswordError(error: FsError | null | undefined): boolean {
  return error?.code === 'archive_password_required' || error?.code === 'archive_password_wrong';
}

/**
 * Bridge from the places that hit an encrypted archive (listing in a panel,
 * Enter on an entry, extract jobs) to the password dialog of the archive
 * feature – the panels need not know that feature (design 025 E4).
 */
@Injectable({ providedIn: 'root' })
export class ArchivePasswordPrompt {
  private handler: ((req: PasswordNeeded) => void) | null = null;

  /** The archive feature shows the dialog; returns the unregister function. */
  setHandler(handler: (req: PasswordNeeded) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = null;
      }
    };
  }

  /** Asks for the password if `error` is a password error with a path; true = asked. */
  askFor(error: FsError, archive: string | null, retry: () => unknown): boolean {
    const path = archive ?? error.path;
    if (!isPasswordError(error) || !path || !this.handler) {
      return false;
    }
    this.handler({ archive: path, wrong: error.code === 'archive_password_wrong', retry });
    return true;
  }
}
