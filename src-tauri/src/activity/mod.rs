//! What the person at this machine is doing outside Aural.
//!
//! Games do not report to Aural and never will, so nothing here asks them to.
//! There are two sources instead, and both read what is already there:
//!
//!   * `media` — the operating system's media session, which is what draws the
//!     track on the lock screen. Every player that can be paused by a keyboard
//!     key populates it, so this covers Spotify, a browser tab and a local
//!     player alike, without any of them knowing Aural exists.
//!   * `rpc` — the rich-presence socket a game opens when it wants to publish
//!     what it is doing. The protocol is spoken to a local pipe by a name that
//!     is not ours, so this is a matter of being the thing listening on it
//!     rather than of intercepting anything: the game never learns the
//!     difference, because there is nothing for it to learn.
//!
//! Neither source can be asked for the whole picture, so the shell reports each
//! one separately as it changes and the page decides what to say. That split is
//! deliberate: what wins between a game and a track is a product decision, and
//! it belongs where the rest of them are.
//!
//! Nothing here talks to a network. A name comes off the running process and
//! artwork off the bytes the media session hands over, which keeps a feature
//! about somebody's own computer from being a reason to call anybody's server.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

mod media;
mod rpc;

/// The event carrying one source's latest reading.
pub const EVENT_REPORT: &str = "activity://report";
/// The event carrying the state of the rich-presence socket.
pub const EVENT_RPC: &str = "activity://rpc";

/// One reading, in the shape the protocol already speaks.
///
/// It is the wire form rather than a form of its own so that the page has
/// nothing to translate: what arrives here is what is sent on, minus whatever
/// the settings say to leave out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// "listening" or "playing".
    #[serde(rename = "type")]
    pub kind: String,
    pub name: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub details: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub state: String,
    #[serde(skip_serializing_if = "is_zero", default)]
    pub started_at: i64,
    #[serde(skip_serializing_if = "is_zero", default)]
    pub ends_at: i64,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub image: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub icon: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub image_text: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub icon_text: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub party: Option<Party>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Party {
    pub size: u32,
    pub max: u32,
}

fn is_zero(value: &i64) -> bool {
    *value == 0
}

/// Which source a reading came from. The page keeps one of each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Media,
    Games,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    source: Source,
    /// Absent when the source has nothing to say — the music stopped, the game
    /// closed — which the page forwards as a clear.
    activity: Option<Activity>,
}

/// What the rich-presence socket is doing, and why.
///
/// `Conflict` is the one that has to be said out loud. Only one process on a
/// machine can hold the socket games look for, and if Discord is running it is
/// holding it: games will report to Discord and nothing will reach Aural. That
/// is not a failure anybody can debug from the outside — it looks exactly like
/// a feature that does not work — so it is reported as its own state and the
/// settings page says so in as many words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RpcState {
    /// Not switched on.
    Off,
    /// Holding the socket. Games that open one will be heard.
    Listening,
    /// Something else already holds it — in practice, Discord.
    Conflict,
    /// This platform has no implementation.
    Unsupported,
    /// It could not be opened, for a reason that is not a conflict.
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcReport {
    pub state: RpcState,
    /// The socket that was tried, so a support question has something in it.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub socket: String,
}

/// What the page can ask for without waiting for an event.
///
/// A settings page opened ten minutes after startup has missed every event the
/// shell sent, so it asks instead. The alternative — replaying the last event
/// on subscribe — would mean the shell keeping a queue for a listener that may
/// never exist.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityReport {
    /// Whether this platform can read a media session at all.
    pub media_supported: bool,
    /// Why not, when it cannot. Empty otherwise.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub media_reason: String,
    pub rpc: RpcReport,
}

/// The switches, as the shell holds them.
///
/// They are atomics rather than a lock because they are read on every tick of
/// two loops and written when somebody moves a switch, which is the shape a
/// relaxed atomic is for.
pub struct State {
    media: AtomicBool,
    games: AtomicBool,
    artwork: AtomicBool,
    /// The last thing the socket reported, so `activity_state` can answer
    /// without the supervisor being asked.
    rpc: Mutex<RpcReport>,
}

impl State {
    fn new() -> Self {
        Self {
            media: AtomicBool::new(false),
            games: AtomicBool::new(false),
            artwork: AtomicBool::new(true),
            rpc: Mutex::new(RpcReport {
                state: RpcState::Off,
                socket: String::new(),
            }),
        }
    }

    pub fn media_wanted(&self) -> bool {
        self.media.load(Ordering::Relaxed)
    }

    pub fn games_wanted(&self) -> bool {
        self.games.load(Ordering::Relaxed)
    }

    /// Whether to spend a decode on the cover. Held here rather than left to
    /// the page because the cost is on this side: a page that filtered the
    /// picture out afterwards would have paid for it anyway.
    pub fn artwork_wanted(&self) -> bool {
        self.artwork.load(Ordering::Relaxed)
    }

    fn set_rpc(&self, report: RpcReport) {
        if let Ok(mut held) = self.rpc.lock() {
            *held = report;
        }
    }

    fn rpc(&self) -> RpcReport {
        self.rpc
            .lock()
            .map(|held| held.clone())
            .unwrap_or(RpcReport {
                state: RpcState::Error,
                socket: String::new(),
            })
    }
}

/// Sends one source's reading to the page.
fn emit<R: Runtime>(app: &AppHandle<R>, source: Source, activity: Option<Activity>) {
    // Best effort throughout: a window that has gone away is not a reason for
    // a background thread to stop reading, because the next one will want an
    // answer the moment it asks.
    let _ = app.emit(EVENT_REPORT, Report { source, activity });
}

/// Sends the state of the rich-presence socket to the page, and remembers it.
fn emit_rpc<R: Runtime>(app: &AppHandle<R>, state: &Arc<State>, report: RpcReport) {
    state.set_rpc(report.clone());
    let _ = app.emit(EVENT_RPC, report);
}

/// Starts both sources. Called once, during setup.
///
/// Both begin switched off and stay dormant until the page says otherwise:
/// reading what somebody is listening to is not something to start doing
/// because an application launched.
pub fn start<R: Runtime>(app: &AppHandle<R>) -> Arc<State> {
    let state = Arc::new(State::new());
    media::start(app.clone(), state.clone());
    rpc::start(app.clone(), state.clone());
    state
}

/// Reports what this machine can do, and what the socket is doing.
#[tauri::command]
pub fn activity_state(state: tauri::State<'_, Arc<State>>) -> ActivityReport {
    let (media_supported, media_reason) = media::support();
    ActivityReport {
        media_supported,
        media_reason: media_reason.to_string(),
        rpc: state.rpc(),
    }
}

/// Switches the two sources on or off.
///
/// Turning games off releases the socket rather than merely ignoring what
/// arrives on it. Holding a socket whose reports are being thrown away would
/// keep Discord from taking it for no benefit at all, which is the rudest
/// possible way to implement a switch that is off.
#[tauri::command]
pub fn activity_configure(
    state: tauri::State<'_, Arc<State>>,
    media: bool,
    games: bool,
    artwork: bool,
) {
    state.media.store(media, Ordering::Relaxed);
    state.games.store(games, Ordering::Relaxed);
    state.artwork.store(artwork, Ordering::Relaxed);
}
