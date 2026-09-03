//! The Tauri shell around the web client.
//!
//! There is deliberately almost nothing here. Everything Aural does lives in
//! the web application; the shell exists to package it, and to be the place
//! native capabilities land: message toasts are wired up here, because a
//! webview cannot raise one itself, and so is the tray icon, along with the
//! settings that decide whether the window goes to it instead of closing. A
//! global push-to-talk hotkey and pinning self-signed certificates so a server
//! reached by address can still be served over TLS are still to come.

mod media;
// Desktop only, and every line of it: a tray icon, a window that can be hidden
// and an application that launches with the session are three things a phone
// does not have.
#[cfg(desktop)]
mod system;

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
    let context = tauri::generate_context!();

    // Read before anything is built, because one of these has to be acted on
    // before a webview exists: both browser engines decide whether to use the
    // GPU when they start, from the environment they start in, and by `setup`
    // the window has already been made.
    #[cfg(desktop)]
    let (identifier, settings) = {
        let identifier = context.config().identifier.clone();
        let settings = system::Settings::load(&identifier);
        system::apply_renderer_flags(settings.hardware_acceleration);
        (identifier, settings)
    };

    let builder = tauri::Builder::default();

    // First, before every other plugin, which is what this one asks for: it
    // works by claiming a lock that the second process finds already held, and
    // that has to happen before the second process has set anything else up.
    //
    // What it prevents is not two windows. Two processes would both hold the
    // same saved session and the same tray icon, and the one somebody is
    // looking at would not be the one showing their unread count. A second
    // launch is a request to see the client, so it is answered by showing the
    // window the first one already has — which is the whole reason this
    // matters now that the window can be hidden.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        system::restore(app);
    }));

    // Toasts for messages that arrive while the window is not being read. The
    // web build uses the browser Notification API for the same thing; this is
    // the half a webview cannot do for itself.
    let builder = builder.plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = {
        builder
            // Driven from `system`, never from the page: the settings page
            // reaches it through this shell's own commands, so the whole
            // system settings surface is one pair of calls rather than two
            // unrelated APIs.
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ))
            .manage(system::State::new(identifier, settings))
            .invoke_handler(tauri::generate_handler![
                open_url,
                save_file,
                system::get_system_settings,
                system::set_system_settings,
                system::set_tray_labels,
                system::restart_app,
            ])
    };

    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![open_url, save_file]);

    builder
        .setup(|_app| {
            // Desktop only. Android grants the WebView its microphone through
            // the manifest and its own chrome client, which is a different
            // mechanism reached through a handle this does not have.
            #[cfg(desktop)]
            {
                use tauri::Manager as _;
                let handle = _app.handle().clone();

                // Before the window is dealt with: whether there is a tray is
                // what decides if the window is allowed to disappear into one.
                system::setup_tray(&handle);
                system::watch_close(&handle);

                if let Some(window) = _app.get_webview_window("main") {
                    // Best effort by design: if the handle cannot be reached
                    // the engine shows its own prompt, which is what happened
                    // before this existed.
                    let _ = window.with_webview(|webview| media::allow_microphone(&webview));

                    // The window is configured hidden so that starting in the
                    // tray does not flash it on screen first. Everything else
                    // has to put it back, and the default when in any doubt is
                    // to show it: an application nobody can find is worse than
                    // one that ignored a preference.
                    if !system::should_start_hidden(&handle) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            Ok(())
        })
        .run(context)
        .expect("failed to start the Aural window");
}
