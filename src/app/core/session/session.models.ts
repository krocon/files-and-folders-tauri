/**
 * Session file DTOs. Keep in sync with `src-tauri/src/session.rs`.
 * Rust bounds every value (`sanitize`) – the frontend may send anything.
 */
import type { TableStateIf } from '@guiexpert/table';

export type Side = 'left' | 'right';

export interface TabSession {
  /** Stable within a session. */
  readonly id: string;
  /** `null` = home directory. Opaque platform path. */
  readonly path: string | null;
  /** Display name of the folder (last breadcrumb segment from Rust), `''` = not known yet. */
  readonly title: string;
  /** Visited folders, newest first, max. 15 (navigation in prompt 003). */
  readonly history: readonly string[];
  /** Path of the entry under the cursor. */
  readonly cursor: string | null;
  /** Prompt 003. */
  readonly hiddenVisible: boolean;
  /** Prompt 003. */
  readonly filterActive: boolean;
  /** Prompt 003. */
  readonly filterText: string;
  /** Column layout, sort and scroll of the GuiExpert Table. */
  readonly table: Partial<TableStateIf> | null;
}

export interface PanelSession {
  readonly activeTab: number;
  readonly tabs: readonly TabSession[];
}

export interface Session {
  readonly version: 1;
  readonly activeSide: Side;
  /** Share of the left side (0.15 … 0.85). */
  readonly splitter: number;
  readonly favorites: readonly string[];
  /** Recently visited folders, newest first (max. 20). */
  readonly recent: readonly string[];
  readonly panels: { readonly left: PanelSession; readonly right: PanelSession };
}

export interface AdjustedPath {
  readonly from: string;
  /** `null` = home directory. */
  readonly to: string | null;
}

export interface LoadedSession {
  readonly session: Session;
  /** The file was broken or unreadable – defaults are used. */
  readonly warning: string | null;
  /** Tab folders that no longer existed and were replaced. */
  readonly adjusted: readonly AdjustedPath[];
}
