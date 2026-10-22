import { FsError, FsErrorCode } from './fs.models';
import { FS_ERROR_TEXTS } from './fs-error-texts';

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
  'archive_password_required',
  'archive_password_wrong',
  'invalid_menu',
  'invalid_settings',
  'shell_disabled',
  'shell_busy',
  'changed_since_listing',
  'invalid_command',
  'unquotable_name',
  'drag_not_held',
  'link_not_permitted',
  'relative_link_impossible',
  'symlink_skipped',
  'scan_not_found',
  'scan_busy',
  'remote_not_connected',
  'remote_auth_failed',
  'remote_unreachable',
  'remote_timeout',
  'remote_connection_lost',
  'remote_host_key_changed',
  'remote_protocol',
  'remote_unsupported',
  'keychain_unavailable',
  'invalid_profile',
  'invalid_url',
  'unknown_profile',
  'unsupported_image',
  'duplicate_changed',
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

/**
 * The translated description of the code, followed by Rust's technical message in
 * parentheses (if it adds something) – the text for error reports (design 015 E5).
 */
export function errorText(error: FsError): string {
  const d = describeFsError(error);
  const m = error.message.trim();
  return m && m !== d ? `${d} (${m})` : d;
}

/** Short user-facing description for an error code (translated by code, design 015 E5). */
export function describeFsError(error: FsError): string {
  return FS_ERROR_TEXTS[error.code] ?? FS_ERROR_TEXTS.unknown;
}
