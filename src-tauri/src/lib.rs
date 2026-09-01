//! The Tauri shell around the web client.
//!
//! There is deliberately almost nothing here. Everything Aural does lives in
//! the web application; the shell exists to package it, and to be the place
//! native capabilities land later: a global push-to-talk hotkey, a tray icon,
//! and pinning self-signed certificates so a server reached by address can
//! still be served over TLS.

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
        .invoke_handler(tauri::generate_handler![open_url, save_file])
        .run(tauri::generate_context!())
        .expect("failed to start the Aural window");
}
