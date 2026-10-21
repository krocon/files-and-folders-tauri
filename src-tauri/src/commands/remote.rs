//! Commands of the server connections (design 034 §3.2). All async; the hub blocks,
//! so every call runs in `spawn_blocking`. Secrets come in once (`password`) and
//! never go back – there is no command that reads a stored secret.

use crate::commands::blocking;
use crate::config_file::ConfigWarning;
use crate::error::FsError;
use crate::remote::profiles::RemoteProfile;
use crate::remote::{ConnState, ConnectOutcome, Remember, RemoteEvent, hub};
use crate::secret::Secret;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedConnections {
    pub profiles: Vec<RemoteProfile>,
    pub states: HashMap<String, ConnState>,
    /// A system keychain can be used.
    pub keychain: bool,
    /// Profiles with a secret entered in this run (shown as "for this session").
    pub session_secrets: Vec<String>,
    pub warning: Option<ConfigWarning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUrl {
    pub profile: RemoteProfile,
    /// The address held a password – it was dropped (never shown or stored).
    pub dropped_password: bool,
}

/// The channels of the windows (state changes of connections).
#[derive(Default)]
pub struct RemoteState {
    channels: Mutex<Vec<Channel<RemoteEvent>>>,
    subscribed: Mutex<bool>,
}

#[tauri::command]
pub async fn load_connections() -> Result<LoadedConnections, FsError> {
    blocking("Loading the connections", || {
        let h = hub()?;
        let (profiles, warning) = h.load();
        let session_secrets = profiles
            .iter()
            .filter(|p| h.has_session_secret(&p.id))
            .map(|p| p.id.clone())
            .collect();
        Ok(LoadedConnections {
            states: h.states(),
            keychain: h.keychain_available(),
            profiles,
            session_secrets,
            warning,
        })
    })
    .await
}

#[tauri::command]
pub async fn save_connection(profile: RemoteProfile) -> Result<RemoteProfile, FsError> {
    blocking("Saving the connection", move || {
        hub()?.save_profile(profile)
    })
    .await
}

#[tauri::command]
pub async fn delete_connection(id: String) -> Result<(), FsError> {
    blocking("Deleting the connection", move || {
        hub()?.delete_profile(&id)
    })
    .await
}

#[tauri::command]
pub async fn remote_connect(
    id: String,
    password: Option<Secret>,
    remember: Option<Remember>,
) -> Result<ConnectOutcome, FsError> {
    blocking("Connecting", move || {
        hub()?.connect(&id, password, remember.unwrap_or_default())
    })
    .await
}

#[tauri::command]
pub async fn remote_trust_host_key(id: String, fingerprint: String) -> Result<(), FsError> {
    blocking("Trusting the host key", move || {
        hub()?.trust_host_key(&id, &fingerprint)
    })
    .await
}

#[tauri::command]
pub async fn remote_trust_certificate(
    id: String,
    sha256: String,
    accept_hostname: bool,
) -> Result<(), FsError> {
    blocking("Trusting the certificate", move || {
        hub()?.trust_certificate(&id, &sha256, accept_hostname)
    })
    .await
}

#[tauri::command]
pub async fn remote_disconnect(id: String) -> Result<(), FsError> {
    blocking("Disconnecting", move || {
        hub()?.disconnect(&id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn remote_forget_secret(id: String) -> Result<(), FsError> {
    blocking("Forgetting the password", move || hub()?.forget_secret(&id)).await
}

#[tauri::command]
pub async fn remote_parse_url(url: String) -> Result<ParsedUrl, FsError> {
    let (profile, dropped_password) = crate::remote::profiles::parse_url(&url)?;
    Ok(ParsedUrl {
        profile,
        dropped_password,
    })
}

/// State changes of the connections for this window.
#[tauri::command]
pub async fn subscribe_remote<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, RemoteState>,
    channel: Channel<RemoteEvent>,
) -> Result<(), FsError> {
    let h = hub()?;
    state
        .channels
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(channel);
    let mut subscribed = state.subscribed.lock().unwrap_or_else(|e| e.into_inner());
    if !*subscribed {
        *subscribed = true;
        // one listener forwards to every channel; closed ones are dropped
        h.subscribe(std::sync::Arc::new(move |ev: RemoteEvent| {
            let st = app.state::<RemoteState>();
            let mut chans = st.channels.lock().unwrap_or_else(|e| e.into_inner());
            chans.retain(|c| c.send(ev.clone()).is_ok());
        }));
    }
    Ok(())
}
