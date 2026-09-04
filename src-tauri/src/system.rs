//! The switches on the "Windows & System" settings page, and the tray icon
//! that three of the four need in order to mean anything.
//!
//! These are the settings the web application cannot hold for itself. Two of
//! them are consulted before the webview exists — whether to put the window on
//! screen at all, and whether to hand the renderer a GPU — and `localStorage`
//! lives inside that webview, so at the moment the answer is wanted there is
//! nothing to ask. They are kept in a small JSON file beside the rest of the
//! application's configuration instead: written by the settings page through a
//! command, and read back by `run` before the builder starts.
//!
//! Launching with the session is the exception. It is not stored here at all,
//! because the operating system is already storing it — a registry value, a
//! LaunchAgent plist, a `.desktop` file — and a copy in our own file would be
//! a second answer free to disagree with the real one. It is read from and
//! written to the system every time it is asked about.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;

/// The tray icon's id, so its menu can be replaced once the page has said
/// which language to write it in.
const TRAY_ID: &str = "main";

const SETTINGS_FILE: &str = "system.json";

/* --- What is stored -------------------------------------------------------- */

/// The settings that live in our own file.
///
/// `serde(default)` rather than a hand-written reader: every field is a bool
/// with a default, so a file written by an older build, truncated by a power
/// cut, or edited by hand degrades field by field instead of being thrown away
/// whole.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub start_minimized: bool,
    pub close_to_tray: bool,
    pub hardware_acceleration: bool,
    /// Whether to look for a new release at startup.
    ///
    /// Kept here rather than in `localStorage` with the rest of the page's
    /// preferences because of what clearing storage would mean for it. Every
    /// other setting comes back as a default somebody notices; this one would
    /// come back as a client that has quietly stopped updating itself, which
    /// is the failure nobody reports. It is also the setting most likely to be
    /// wanted off by the person who cannot see the window.
    pub auto_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            start_minimized: false,
            close_to_tray: true,
            hardware_acceleration: true,
            // On, because the alternative is worse than an unwanted prompt.
            // Servers are self-hosted and move on their operators' schedules,
            // so a client left behind eventually meets one it cannot speak to;
            // the protocol range buys time for that, it does not remove it.
            auto_update: true,
        }
    }
}

/// Where the file lives: the directory Tauri resolves for the application's
/// configuration, reached the same way it reaches it.
///
/// The identifier comes from the generated context rather than being written
/// out again here, so this cannot drift away from `tauri.conf.json`.
fn settings_path(identifier: &str) -> Option<PathBuf> {
    Some(dirs::config_dir()?.join(identifier).join(SETTINGS_FILE))
}

impl Settings {
    /// Reads the file, falling back to the defaults for anything unreadable.
    ///
    /// A missing file is the ordinary first run. A corrupt one is not worth
    /// refusing to start over, because the defaults are a working application.
    pub fn load(identifier: &str) -> Self {
        let Some(path) = settings_path(identifier) else {
            return Self::default();
        };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    fn save(&self, identifier: &str) -> Result<(), String> {
        let path = settings_path(identifier)
            .ok_or_else(|| "no configuration directory on this system".to_string())?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let body = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| e.to_string())
    }
}

/* --- The renderer flags ---------------------------------------------------- */

/// Whether turning the GPU off is something this platform can be asked.
///
/// WebView2 and WebKitGTK both take it as an environment variable read once,
/// when the engine starts. WKWebView does not expose it at all, so on macOS
/// the switch is reported unavailable rather than shown as a lie.
pub const fn hardware_acceleration_supported() -> bool {
    cfg!(any(
        windows,
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))
}

/// Turns the GPU off for the browser engine, when that is what the file says.
///
/// Must run before the first webview is created, which is why `run` calls it
/// before handing anything to the builder. Both engines read these when they
/// start and changing them afterwards changes nothing, which is also why the
/// settings page asks for a restart after this one is touched.
pub fn apply_renderer_flags(hardware_acceleration: bool) {
    if hardware_acceleration {
        return;
    }

    #[cfg(windows)]
    {
        // Appended rather than assigned: somebody debugging the client may
        // have put their own switches in this variable, and dropping them
        // would be a surprising thing for a settings toggle to do.
        const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
        const FLAGS: &str = "--disable-gpu --disable-gpu-compositing";
        let existing = std::env::var(KEY).unwrap_or_default();
        let combined = if existing.trim().is_empty() {
            FLAGS.to_string()
        } else {
            format!("{existing} {FLAGS}")
        };
        std::env::set_var(KEY, combined);
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

/* --- Live state ------------------------------------------------------------ */

/// What the running application knows about all this.
pub struct State {
    /// The bundle identifier, which is half of the settings file's path.
    identifier: String,
    settings: Mutex<Settings>,
    /// Whether a tray icon actually exists.
    ///
    /// Hiding the window is only survivable if there is something to bring it
    /// back. When the tray could not be created — no status area on this
    /// desktop, or the icon refused — "close to tray" and "start minimized"
    /// are not honoured, because honouring them would strand the application
    /// in a process nobody can reach.
    tray: AtomicBool,
    /// Set by the tray's Quit, and by a restart, before the process goes away,
    /// so the close handler knows this one is real and lets the window go.
    quitting: AtomicBool,
}

impl State {
    pub fn new(identifier: String, settings: Settings) -> Self {
        Self {
            identifier,
            settings: Mutex::new(settings),
            tray: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
        }
    }

    fn get(&self) -> Settings {
        // A poisoned lock means a panic while holding it. What is behind it is
        // three bools written as a unit, so it is still readable, and refusing
        // to answer would take the window's close button down with it.
        *self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Whether the close button should hide the window instead of ending the
/// process.
pub fn should_hide_on_close<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<State>() else {
        return false;
    };
    !state.quitting.load(Ordering::SeqCst)
        && state.tray.load(Ordering::SeqCst)
        && state.get().close_to_tray
}

/// Whether the window should stay off screen at startup.
///
/// Answered here rather than at the call site so the "only with a tray" rule
/// is written once and covers both ways the window can vanish.
pub fn should_start_hidden<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(state) = app.try_state::<State>() else {
        return false;
    };
    state.tray.load(Ordering::SeqCst) && state.get().start_minimized
}

/* --- The tray -------------------------------------------------------------- */

/// Puts the window back in front of somebody, from wherever it went.
///
/// All three calls are needed and none subsumes the others: `show` undoes
/// hiding, `unminimize` undoes minimising, and `set_focus` is what raises it
/// above whatever is now on top of it.
///
/// Public because the tray is not the only thing that has to do this. A second
/// launch of the client does too, and for the same reason: somebody is asking
/// to see the window.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<State>() {
        state.quitting.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

fn tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    open: &str,
    quit: &str,
) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &quit])
}

/// Creates the tray icon, and records whether it worked.
///
/// The labels start in English because at this point nothing that knows
/// otherwise has loaded; the page replaces them through `set_tray_labels` as
/// soon as it has mounted with a language.
pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) {
    let built = build_tray(app);
    if let Err(err) = &built {
        // Not fatal, deliberately: everything else about the client works
        // without a status area. What changes is that the two settings which
        // hide the window stop being honoured.
        eprintln!("aural: no tray icon, the window will always close normally: {err}");
    }
    if let Some(state) = app.try_state::<State>() {
        state.tray.store(built.is_ok(), Ordering::SeqCst);
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Aural")
        .menu(&tray_menu(app, "Open Aural", "Quit Aural")?)
        // The left button belongs to "show me the window", which is what a
        // tray icon is for. The menu stays on the right one, where every other
        // tray icon on the desktop keeps it.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => restore(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/* --- What the window's close button does ----------------------------------- */

/// Teaches the main window to hide rather than exit, when that is the setting.
pub fn watch_close<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if should_hide_on_close(&handle) {
                api.prevent_close();
                let _ = hidden.hide();
            }
        }
    });
}

/* --- The commands the settings page calls ---------------------------------- */

/// Everything the settings page draws, including the two answers that decide
/// whether a switch is offered at all.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    launch_on_startup: bool,
    start_minimized: bool,
    close_to_tray: bool,
    hardware_acceleration: bool,
    auto_update: bool,
    /// False on macOS, where the switch is shown disabled with a reason.
    hardware_acceleration_supported: bool,
    /// False when there is no tray icon, which is what makes the two settings
    /// that hide the window inert.
    tray_available: bool,
}

/// A patch: absent means "leave this one alone", which is what a page changing
/// one switch at a time sends.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Patch {
    launch_on_startup: Option<bool>,
    start_minimized: Option<bool>,
    close_to_tray: Option<bool>,
    hardware_acceleration: Option<bool>,
    auto_update: Option<bool>,
}

fn report<R: Runtime>(app: &AppHandle<R>, state: &State) -> Report {
    let settings = state.get();
    Report {
        // Asked of the operating system rather than remembered: somebody who
        // removed the startup entry outside the client should open this page
        // and find the switch off.
        launch_on_startup: app.autolaunch().is_enabled().unwrap_or(false),
        start_minimized: settings.start_minimized,
        close_to_tray: settings.close_to_tray,
        hardware_acceleration: settings.hardware_acceleration,
        auto_update: settings.auto_update,
        hardware_acceleration_supported: hardware_acceleration_supported(),
        tray_available: state.tray.load(Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn get_system_settings<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, State>) -> Report {
    report(&app, &state)
}

/// Applies a change and reports back what is now true.
///
/// The report is the point. A page that trusted its own switch would show
/// "launch on startup" as on after a registry write the system refused;
/// everything here is applied first and read back second.
#[tauri::command]
pub fn set_system_settings<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, State>,
    patch: Patch,
) -> Result<Report, String> {
    // The system-held setting goes first, because it is the one that can fail.
    // Failing after our own file had been written would leave the two
    // disagreeing about a change that did not happen.
    if let Some(enabled) = patch.launch_on_startup {
        let manager = app.autolaunch();
        let result = if enabled {
            manager.enable()
        } else {
            manager.disable()
        };
        result.map_err(|e| e.to_string())?;
    }

    let mut settings = state.get();
    if let Some(value) = patch.start_minimized {
        settings.start_minimized = value;
    }
    if let Some(value) = patch.close_to_tray {
        settings.close_to_tray = value;
    }
    if let Some(value) = patch.hardware_acceleration {
        settings.hardware_acceleration = value;
    }
    if let Some(value) = patch.auto_update {
        settings.auto_update = value;
    }

    settings.save(&state.identifier)?;
    *state.settings.lock().unwrap_or_else(|e| e.into_inner()) = settings;

    Ok(report(&app, &state))
}

/// Replaces the tray menu with one in the language the client is being read in.
///
/// The tray is built before anything that knows the language has loaded, so it
/// starts in English and is corrected once. Without a tray there is no menu to
/// relabel, which is the whole error path.
#[tauri::command]
pub fn set_tray_labels<R: Runtime>(app: AppHandle<R>, open: String, quit: String) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(menu) = tray_menu(&app, &open, &quit) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Restarts the client, which is the only way a renderer flag takes effect.
#[tauri::command]
pub fn restart_app<R: Runtime>(app: AppHandle<R>) {
    // Same reason as the tray's Quit: the process is going away on purpose, so
    // the close handler must not turn the window's disappearance into a hide.
    if let Some(state) = app.try_state::<State>() {
        state.quitting.store(true, Ordering::SeqCst);
    }

    // The single instance lock is let go here, by hand, to close a race.
    //
    // `restart` spawns the replacement and only then exits, so for a moment
    // both processes are alive. The lock is a mutex held for the lifetime of
    // the process and released on the exit event — an event `restart` never
    // reaches, because it leaves through `exit` rather than through the run
    // loop. So the new process races the old one's exit to the mutex, and if
    // it lost it would take itself for a second instance, hand its arguments
    // to a process on its way out, and quit: a restart that closes the client.
    //
    // In practice the old process wins that race comfortably — it exits within
    // microseconds of the spawn, while the new one has a whole Tauri startup
    // to get through first — and a restart without this line was measured
    // working every time. Releasing the lock before the spawn is still worth
    // one line, because it removes the window rather than relying on being on
    // the right side of it.
    //
    // The tray's Quit needs no such thing. That one goes through the run loop,
    // which fires the event the plugin is already listening for.
    tauri_plugin_single_instance::destroy(&app);

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn the_defaults_are_the_ones_the_page_draws() {
        let settings = Settings::default();
        assert!(!settings.start_minimized);
        assert!(settings.close_to_tray);
        assert!(settings.hardware_acceleration);
        assert!(settings.auto_update);
    }

    #[test]
    fn a_partial_file_keeps_the_defaults_for_what_it_omits() {
        let settings: Settings = serde_json::from_str("{\"closeToTray\":false}").unwrap();
        assert!(!settings.close_to_tray);
        assert!(settings.hardware_acceleration);
        assert!(!settings.start_minimized);
        // The one that matters most here: a file written by a build older than
        // this setting must come back updating itself, not silently frozen.
        assert!(settings.auto_update);
    }

    #[test]
    fn an_unusable_file_is_not_a_reason_to_refuse_to_start() {
        // Which is what `load` turns into the defaults rather than a failure.
        let recovered: Settings = serde_json::from_str("not json").unwrap_or_default();
        assert!(recovered.close_to_tray);
        assert!(recovered.hardware_acceleration);
    }

    #[test]
    fn it_round_trips_through_the_names_the_page_uses() {
        let settings = Settings {
            start_minimized: true,
            close_to_tray: false,
            hardware_acceleration: false,
            auto_update: false,
        };
        let encoded = serde_json::to_string(&settings).unwrap();
        assert!(encoded.contains("startMinimized"));
        assert!(encoded.contains("autoUpdate"));
        let decoded: Settings = serde_json::from_str(&encoded).unwrap();
        assert!(decoded.start_minimized);
        assert!(!decoded.close_to_tray);
        assert!(!decoded.hardware_acceleration);
        assert!(!decoded.auto_update);
    }
}
