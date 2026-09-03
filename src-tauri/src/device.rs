//! What this installation can honestly say about the machine it runs on.
//!
//! It exists for one thing: making a ban stick. A server that hands out guest
//! identities to anybody who asks cannot ban an account and be done, because
//! the next account is one click away; the address helps and is shared by a
//! household and changed by a reboot. What is left is the machine, and this is
//! the machine, as far as an application that wants nothing to do with an
//! antivirus scanner can tell.
//!
//! So: no hardware serials, no volume identifiers, no registry, no spawned
//! processes, no drivers. Two ordinary things instead —
//!
//!   * a random identifier this installation wrote once and keeps, in the
//!     steadiest place the platform offers. It survives clearing the browser
//!     profile, signing out, updating the application and, where the machine
//!     has a shared directory to put it in, switching to a different user
//!     account on the same computer.
//!   * a description of the machine assembled from what the operating system
//!     hands any process for free: the platform, the architecture, the number
//!     of processors, the host name, and on Linux the machine id every system
//!     already publishes at a readable path.
//!
//! Neither is a wall and neither is meant to be. Somebody who reinstalls the
//! operating system, or reads this file and edits it, is through — and so they
//! should be, because the alternative is the kind of software that reads
//! hardware serials, and that is a thing to be scanned for rather than shipped.
//! What this raises is the cost of the ordinary case: closing the client,
//! opening it again, and coming straight back as a new guest.
//!
//! Both values leave here in the clear and are hashed by the page, together
//! with a salt the server minted. The server therefore never learns either of
//! them, every server sees a different value for the same machine, and nothing
//! here can be used to follow somebody between servers.

use std::path::PathBuf;

use serde::Serialize;

/// The file the persisted identifier lives in.
const DEVICE_FILE: &str = "device";

/// What the page is handed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    /// The random identifier this installation keeps. Empty only when nowhere
    /// was writable, which leaves the machine description to carry it alone.
    pub install_id: String,
    /// A description of the machine, assembled from what the system offers
    /// any process for nothing.
    pub machine: String,
}

/// Where the identifier may live, steadiest first.
///
/// The shared directory comes first on Windows because it is the one that
/// survives switching to another user account on the same computer, which is
/// the cheapest thing somebody who has been banned will try. It is best effort:
/// a locked-down machine will refuse it, and the per-user directory behind it
/// is the ordinary answer.
fn candidates(identifier: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();

    #[cfg(windows)]
    if let Ok(shared) = std::env::var("ProgramData") {
        out.push(PathBuf::from(shared).join(identifier).join(DEVICE_FILE));
    }

    if let Some(config) = dirs::config_dir() {
        out.push(config.join(identifier).join(DEVICE_FILE));
    }
    if let Some(data) = dirs::data_dir() {
        out.push(data.join(identifier).join(DEVICE_FILE));
    }
    out
}

/// Reads the stored identifier, writing one the first time.
///
/// Every candidate is read before any is written, so an installation that
/// could once write to the shared directory and now cannot keeps the identifier
/// it already had rather than quietly becoming a different machine.
fn install_id(identifier: &str) -> String {
    let paths = candidates(identifier);

    for path in &paths {
        if let Ok(raw) = std::fs::read_to_string(path) {
            let value = raw.trim();
            if !value.is_empty() && value.len() <= 128 {
                return value.to_string();
            }
        }
    }

    let minted = mint();
    for path in &paths {
        if let Some(parent) = path.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                continue;
            }
        }
        if std::fs::write(path, &minted).is_ok() {
            return minted;
        }
    }
    // Nowhere was writable. The machine description still identifies the
    // computer a little, and a client that sends a weaker value is better than
    // one that refuses to connect.
    String::new()
}

/// Mints a random identifier.
///
/// The randomness is the system's, by way of the address space and the clock:
/// pulling in a crypto dependency for a value whose only job is to be
/// different on every machine would be a strange trade. It is written once and
/// never regenerated, so a birthday collision across two installations would
/// have to happen on the same nanosecond to matter at all.
fn mint() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let stack = &nanos as *const u128 as usize;
    let heap = Box::into_raw(Box::new(0u8)) as usize;
    // Reclaimed immediately: only its address was wanted.
    unsafe { drop(Box::from_raw(heap as *mut u8)) };

    format!("{nanos:032x}{stack:016x}{heap:016x}")
}

/// Describes the machine from what the system hands any process for free.
fn machine() -> String {
    let mut parts = vec![
        std::env::consts::OS.to_string(),
        std::env::consts::ARCH.to_string(),
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0)
            .to_string(),
    ];

    if let Some(host) = hostname() {
        parts.push(host);
    }
    // Every systemd machine publishes this, it is readable by anybody, and it
    // is exactly the value this wants: stable for the life of the install and
    // meaningless off it.
    #[cfg(target_os = "linux")]
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(raw) = std::fs::read_to_string(path) {
            let value = raw.trim();
            if !value.is_empty() {
                parts.push(value.to_string());
                break;
            }
        }
    }

    parts.join("|")
}

/// The host name, from the environment or the one file that carries it.
fn hostname() -> Option<String> {
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    #[cfg(unix)]
    if let Ok(raw) = std::fs::read_to_string("/etc/hostname") {
        let value = raw.trim().to_string();
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

/// Hands the page what it needs to build a device identifier.
///
/// Nothing here is secret and nothing here leaves the machine as it is: the
/// page hashes both values together with a salt the server minted, and sends
/// only the hash.
#[tauri::command]
pub fn device_fingerprint(app: tauri::AppHandle) -> Fingerprint {
    let identifier = app.config().identifier.clone();
    Fingerprint {
        install_id: install_id(&identifier),
        machine: machine(),
    }
}
