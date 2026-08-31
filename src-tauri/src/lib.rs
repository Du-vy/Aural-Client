//! The Tauri shell around the web client.
//!
//! There is deliberately almost nothing here. Everything Aural does lives in
//! the web application; the shell exists to package it, and to be the place
//! native capabilities land later: a global push-to-talk hotkey, a tray icon,
//! and pinning self-signed certificates so a server reached by address can
//! still be served over TLS.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start the Aural window");
}
