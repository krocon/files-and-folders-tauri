import { FsError, FsErrorCode } from './fs.models';

const KNOWN_CODES: ReadonlySet<string> = new Set<FsErrorCode>([
  'not_found',
  'permission_denied',
  'not_a_directory',
  'not_a_file',
  'executable',
  'target_inside_source',
  'same_source_target',
  'disk_full',
  'invalid_path',
  'no_home_directory',
  'io',
  'no_backend',
  'unknown',
]);

/** Normalises anything thrown by `invoke()` into a typed {@link FsError}. */
export function toFsError(err: unknown): FsError {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const rec = err as Record<string, unknown>;
    const code =
      typeof rec['code'] === 'string' && KNOWN_CODES.has(rec['code']) ? rec['code'] : 'unknown';
    return {
      code: code as FsErrorCode,
      message: typeof rec['message'] === 'string' ? rec['message'] : String(err),
      path: typeof rec['path'] === 'string' ? rec['path'] : null,
    };
  }
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err), path: null };
}

/** Short user-facing description for an error code. */
export function describeFsError(error: FsError): string {
  switch (error.code) {
    case 'not_found':
      return 'The file or folder does not exist (anymore).';
    case 'permission_denied':
      return 'Access denied – you do not have permission to read this folder.';
    case 'not_a_directory':
      return 'This is not a folder.';
    case 'not_a_file':
      return 'This is a folder, not a file.';
    case 'executable':
      return 'This file is a program.';
    case 'target_inside_source':
      return 'The target folder lies inside the source folder.';
    case 'same_source_target':
      return 'Source and target folder are the same.';
    case 'disk_full':
      return 'The disk is full.';
    case 'invalid_path':
      return 'The path is invalid.';
    case 'no_home_directory':
      return 'Your home folder could not be determined.';
    case 'no_backend':
      return 'The desktop backend is not available. Start the app with "pnpm tauri dev".';
    case 'io':
    case 'unknown':
      return 'The folder could not be read.';
  }
}
