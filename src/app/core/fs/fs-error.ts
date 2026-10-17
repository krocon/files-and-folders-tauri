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
  'already_exists',
  'invalid_name',
  'dangerous_path',
  'trash_failed',
  'duplicate_target',
  'undo_unavailable',
  'program_not_found',
  'unknown_tool',
  'too_many_files',
  'too_many',
  'invalid_pattern',
  'archive_error',
  'unsafe_entry',
  'archive_too_large',
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
    case 'already_exists':
      return 'A file or folder with this name exists already.';
    case 'invalid_name':
      return 'This name is not allowed.';
    case 'dangerous_path':
      return 'This is a drive, your home folder or a system folder.';
    case 'trash_failed':
      return 'The item could not be moved to the trash.';
    case 'duplicate_target':
      return 'Another selected entry gets the same name.';
    case 'undo_unavailable':
      return 'There is nothing to undo.';
    case 'program_not_found':
      return 'The program was not found – is it installed? (tools.json)';
    case 'unknown_tool':
      return 'This tool is not configured (anymore).';
    case 'too_many_files':
      return 'Too many entries for this tool.';
    case 'too_many':
      return 'Too many items at once.';
    case 'invalid_pattern':
      return 'The search pattern is invalid.';
    case 'archive_error':
      return 'The archive is broken or uses an unsupported feature.';
    case 'unsafe_entry':
      return 'An archive entry would leave the target folder or is a link – not extracted.';
    case 'archive_too_large':
      return 'The archive exceeds the safety limits (size, number of entries).';
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
