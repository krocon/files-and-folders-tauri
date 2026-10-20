import { ArchiveApi } from '../app/core/archive/archive-api';

/** In-memory ArchiveApi: `passwords` by archive path; anything else is "wrong". */
export class FakeArchiveApi extends ArchiveApi {
  readonly passwords = new Map<string, string>();
  readonly calls: { archive: string; password: string }[] = [];

  setPassword(archive: string, password: string): Promise<void> {
    this.calls.push({ archive, password });
    if (this.passwords.get(archive) === password) {
      return Promise.resolve();
    }
    return Promise.reject({
      code: 'archive_password_wrong',
      message: 'Wrong password',
      path: archive,
    });
  }
}
