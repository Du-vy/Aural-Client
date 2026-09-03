//! The Tauri shell around the web client.
//!
//! There is deliberately almost nothing here. Everything Aural does lives in
//! the web application; the shell exists to package it, and to be the place
//! native capabilities land: message toasts are wired up here, because a
//! webview cannot raise one itself. A global push-to-talk hotkey, a tray icon
//! and pinning self-signed certificates so a server reached by address can
//! still be served over TLS are still to come.

mod media;

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
    }
    Ok(())
}

#[tauri::command]
async fn save_file(
    default_name: String,
    content: String,
    filter_name: Option<String>,
    filter_extensions: Option<Vec<String>>,
) -> Result<bool, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_file_name(&default_name);
    if let (Some(name), Some(exts)) = (filter_name.as_deref(), filter_extensions.as_ref()) {
        if !name.is_empty() && !exts.is_empty() {
            let str_exts: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
            dialog = dialog.add_filter(name, &str_exts);
        }
    }
    let file = dialog.save_file().await;
    if let Some(handle) = file {
        handle
            .write(content.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Toasts for messages that arrive while the window is not being read.
        // The web build uses the browser Notification API for the same thing;
        // this is the half a webview cannot do for itself.
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![open_url, save_file])
        .setup(|_app| {
            // Desktop only. Android grants the WebView its microphone through
            // the manifest and its own chrome client, which is a different
            // mechanism reached through a handle this does not have.
            #[cfg(desktop)]
            {
                use tauri::Manager as _;
                if let Some(window) = _app.get_webview_window("main") {
                    // Best effort by design: if the handle cannot be reached
                    // the engine shows its own prompt, which is what happened
                    // before this existed.
                    let _ = window.with_webview(|webview| media::allow_microphone(&webview));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the Aural window");
}
