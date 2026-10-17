//! Files and Folders – Tauri backend.
//!
//! Module overview:
//! - [`error`]    structured, serialisable file-system errors
//! - [`model`]    DTOs shared with the Angular frontend (keep in sync with `src/app/core/fs/fs.models.ts`)
//! - [`paths`]    platform-aware path helpers (validation, parent, breadcrumbs)
//! - [`listing`]  directory listing logic (pure, unit-tested, no Tauri dependency)
//! - [`commands`] thin Tauri command layer

pub mod commands;
pub mod error;
pub mod listing;
pub mod model;
pub mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::list_directory])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
