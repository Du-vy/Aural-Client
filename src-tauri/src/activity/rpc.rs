//! The rich-presence socket a game opens when it wants to publish what it is
//! doing.
//!
//! A game with rich presence does not talk to a service over the network. It
//! opens a local pipe by a well-known name and writes JSON frames into it, and
//! whatever process created that pipe is what receives them. There is no
//! authentication, no signature and nothing to spoof: the protocol was never
//! designed to establish who is listening, only to carry a few lines of text
//! across a machine. So this is not an interception. It is a server, listening
//! on the name the games were already told to use.
//!
//! The frame format is four bytes of opcode, four of length, both little
//! endian, and then that many bytes of JSON. Five opcodes exist and this speaks
//! four of them.
//!
//! ## Only one process can hold it
//!
//! The name is a single slot, and Discord takes it when Discord is running.
//! There is no way to share it and no way to take it from underneath: a game
//! connects to whoever got there first. That is the single most important
//! thing this module reports, because a socket that is held by somebody else
//! looks exactly like a feature that silently does not work. It is detected
//! before the socket is created — by trying to connect to it as a client would
//! — and reported as its own state for the settings page to explain.
//!
//! Holding it is also given up the moment the switch is turned off, rather
//! than merely ignored. Sitting on a socket whose reports are being discarded
//! would keep Discord from taking it for no benefit to anybody.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Runtime};

use super::{Activity, Party, RpcReport, RpcState, Source, State};

/// The longest frame that will be read.
///
/// Anything larger is a local process misbehaving, and the interesting part of
/// a rich presence is a few hundred bytes. The cap is what stops a frame header
/// claiming four gigabytes from being believed.
const MAX_FRAME: u32 = 64 * 1024;

/// How long a poll of the switch waits before looking again. It bounds how
/// long the socket stays held after somebody turns the feature off.
const TICK: Duration = Duration::from_secs(1);

/// How long to wait before looking again at a socket somebody else holds.
const RETRY: Duration = Duration::from_secs(10);

/// Opcodes, as the protocol numbers them.
const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

/// What one connected game asked for, as it arrives on the wire.
#[derive(Debug, Deserialize)]
struct Command {
    #[serde(default)]
    cmd: String,
    #[serde(default)]
    args: Args,
    #[serde(default)]
    nonce: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Args {
    #[serde(default)]
    pid: Option<u32>,
    #[serde(default)]
    activity: Option<Presence>,
}

/// The activity as a game states it, which is not quite the shape sent on.
#[derive(Debug, Default, Deserialize)]
struct Presence {
    #[serde(default)]
    details: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    timestamps: Option<Timestamps>,
    #[serde(default)]
    assets: Option<Assets>,
    #[serde(default)]
    party: Option<PresenceParty>,
}

#[derive(Debug, Default, Deserialize)]
struct Timestamps {
    #[serde(default)]
    start: Option<i64>,
    #[serde(default)]
    end: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
struct Assets {
    #[serde(default)]
    large_image: Option<String>,
    #[serde(default)]
    large_text: Option<String>,
    #[serde(default)]
    small_image: Option<String>,
    #[serde(default)]
    small_text: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PresenceParty {
    /// `[current, maximum]`, which is how the protocol carries it.
    #[serde(default)]
    size: Option<Vec<u32>>,
}

/// The handshake, which carries the only identifier a game offers.
#[derive(Debug, Default, Deserialize)]
struct Handshake {
    #[serde(default)]
    client_id: Option<String>,
}

/// Who is currently reporting, and what.
///
/// Several games can be connected at once — a launcher and the game it
/// launched, most often — so the reports are kept as a list and the newest one
/// is what is shown. Keeping the list rather than a single value is what makes
/// a game closing put the previous one back rather than clearing everything.
#[derive(Default)]
struct Reports {
    live: Vec<(u64, Activity)>,
}

impl Reports {
    fn set(&mut self, id: u64, activity: Option<Activity>) {
        self.live.retain(|(held, _)| *held != id);
        if let Some(activity) = activity {
            self.live.push((id, activity));
        }
    }

    fn current(&self) -> Option<Activity> {
        self.live.last().map(|(_, activity)| activity.clone())
    }
}

/// Everything a connection handler needs to reach.
struct Shared<R: Runtime> {
    app: AppHandle<R>,
    state: Arc<State>,
    reports: Mutex<Reports>,
    /// Hands out an id per connection, so that a game closing can be told
    /// apart from a game that merely stopped reporting.
    next_id: AtomicU64,
    /// What was last sent to the page, so a report that changes nothing is not
    /// forwarded.
    last: Mutex<Option<Activity>>,
}

impl<R: Runtime> Shared<R> {
    fn publish(&self, id: u64, activity: Option<Activity>) {
        let current = {
            let Ok(mut reports) = self.reports.lock() else {
                return;
            };
            reports.set(id, activity);
            reports.current()
        };
        let Ok(mut last) = self.last.lock() else {
            return;
        };
        if *last != current {
            *last = current.clone();
            super::emit(&self.app, Source::Games, current);
        }
    }

    /// Drops everything, which is what turning the switch off has to mean.
    fn clear(&self) {
        if let Ok(mut reports) = self.reports.lock() {
            reports.live.clear();
        }
        let Ok(mut last) = self.last.lock() else {
            return;
        };
        if last.is_some() {
            *last = None;
            super::emit(&self.app, Source::Games, None);
        }
    }
}

pub fn start<R: Runtime>(app: AppHandle<R>, state: Arc<State>) {
    let shared = Arc::new(Shared {
        app,
        state,
        reports: Mutex::new(Reports::default()),
        next_id: AtomicU64::new(1),
        last: Mutex::new(None),
    });
    std::thread::Builder::new()
        .name("aural-rich-presence".into())
        .spawn(move || supervise(shared))
        .ok();
}

/// Holds the socket for as long as the switch is on, and says what happened.
fn supervise<R: Runtime>(shared: Arc<Shared<R>>) {
    let mut announced: Option<RpcState> = None;
    let mut announce = |state: RpcState, socket: &str| {
        if announced != Some(state) {
            announced = Some(state);
            super::emit_rpc(
                &shared.app,
                &shared.state,
                RpcReport {
                    state,
                    socket: socket.to_string(),
                },
            );
        }
    };

    loop {
        if !shared.state.games_wanted() {
            shared.clear();
            announce(RpcState::Off, "");
            std::thread::sleep(TICK);
            continue;
        }

        if !platform::SUPPORTED {
            announce(RpcState::Unsupported, "");
            std::thread::sleep(RETRY);
            continue;
        }

        let socket = platform::socket_name();
        match platform::claim(&socket) {
            Ok(Some(listener)) => {
                announce(RpcState::Listening, &socket);
                // Returns when the switch goes off, or when the socket itself
                // fails in a way that is worth starting over from.
                platform::serve(listener, &shared);
                shared.clear();
            }
            // Somebody else has it. In practice that somebody is Discord, and
            // there is nothing to do but say so and look again later: games
            // will be reporting to them, not here.
            Ok(None) => {
                shared.clear();
                announce(RpcState::Conflict, &socket);
                std::thread::sleep(RETRY);
            }
            Err(_) => {
                shared.clear();
                announce(RpcState::Error, &socket);
                std::thread::sleep(RETRY);
            }
        }
    }
}

/// Runs one connection to the end.
///
/// `read` and `write` are the platform's, so everything that is actually the
/// protocol lives here once rather than twice.
fn converse<R: Runtime>(
    shared: &Arc<Shared<R>>,
    mut read: impl FnMut(&mut [u8]) -> std::io::Result<bool>,
    mut write: impl FnMut(u32, &[u8]) -> std::io::Result<()>,
) {
    let id = shared.next_id.fetch_add(1, Ordering::Relaxed);
    let mut name = String::new();
    // The application id from the handshake, kept apart from the name because
    // the two are wanted for different things: the name is overwritten by
    // whatever the process turns out to be called, while this stays, and is
    // the only thing that can say which application's artwork a bare asset key
    // belongs to.
    let mut application = String::new();
    let mut handshook = false;
    let mut header = [0u8; 8];
    let mut body = Vec::new();

    loop {
        if !shared.state.games_wanted() {
            break;
        }
        match read(&mut header) {
            Ok(true) => {}
            // The connection is idle, which is the ordinary state of a game
            // that has said what it is doing and is now playing it.
            Ok(false) => continue,
            Err(_) => break,
        }

        let op = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
        let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
        if len > MAX_FRAME {
            break;
        }
        body.clear();
        body.resize(len as usize, 0);
        if len > 0 {
            match read(&mut body) {
                Ok(true) => {}
                // A header arrived and its body did not. There is no way to
                // resynchronise a stream framed by length, so the connection
                // goes; the game will open another.
                _ => break,
            }
        }

        match op {
            OP_HANDSHAKE => {
                let handshake: Handshake = serde_json::from_slice(&body).unwrap_or_default();
                let client_id = handshake.client_id.unwrap_or_default();
                if name.is_empty() {
                    name = client_id.clone();
                }
                application = client_id;
                handshook = true;
                let ready = json!({
                    "cmd": "DISPATCH",
                    "evt": "READY",
                    "data": {
                        "v": 1,
                        "config": {
                            "cdn_host": "cdn.discordapp.com",
                            "api_endpoint": "//discord.com/api",
                            "environment": "production"
                        },
                        // A game's SDK reads this to decide the handshake
                        // worked. Nothing here claims to be anybody: the
                        // identity Aural has for this person is on the server
                        // they are connected to, and is none of a game's
                        // business.
                        "user": {
                            "id": "0",
                            "username": "aural",
                            "discriminator": "0",
                            "global_name": "Aural",
                            "avatar": null,
                            "bot": false,
                            "flags": 0,
                            "premium_type": 0
                        }
                    }
                });
                if write(OP_FRAME, ready.to_string().as_bytes()).is_err() {
                    break;
                }
            }

            OP_FRAME => {
                if !handshook {
                    break;
                }
                let command: Command = match serde_json::from_slice(&body) {
                    Ok(command) => command,
                    Err(_) => continue,
                };
                let nonce = command.nonce.clone();

                if command.cmd == "SET_ACTIVITY" {
                    // The process is the only place a readable name can come
                    // from: the handshake carries an application id and
                    // nothing else, and resolving one would mean asking
                    // Discord, over the network, what this person is running.
                    if let Some(pid) = command.args.pid {
                        if let Some(resolved) = platform::process_name(pid) {
                            name = resolved;
                        }
                    }
                    let activity = command
                        .args
                        .activity
                        .as_ref()
                        .map(|presence| translate(&name, &application, presence));
                    shared.publish(id, activity);
                }

                // Every command is answered, including the ones that are not
                // acted on. An SDK waiting on a nonce it never gets will sit
                // there rather than carry on.
                let reply = json!({
                    "cmd": if command.cmd.is_empty() { "DISPATCH".to_string() } else { command.cmd },
                    "data": null,
                    "evt": null,
                    "nonce": nonce,
                });
                if write(OP_FRAME, reply.to_string().as_bytes()).is_err() {
                    break;
                }
            }

            OP_PING => {
                if write(OP_PONG, &body).is_err() {
                    break;
                }
            }

            OP_CLOSE => break,

            _ => break,
        }
    }

    // Whatever this connection was reporting goes with it. A game that has
    // closed is not being played.
    shared.publish(id, None);
}

/// Maps what a game said onto what the protocol carries.
fn translate(name: &str, application: &str, presence: &Presence) -> Activity {
    let (started_at, ends_at) = match &presence.timestamps {
        Some(stamps) => (normalise_time(stamps.start), normalise_time(stamps.end)),
        None => (0, 0),
    };

    let assets = presence.assets.as_ref();
    let party = presence.party.as_ref().and_then(|party| {
        let size = party.size.as_ref()?;
        Some(Party {
            size: size.first().copied().unwrap_or(0),
            max: size.get(1).copied().unwrap_or(0),
        })
    });

    Activity {
        kind: "playing".into(),
        name: truncate(if name.is_empty() { "A game" } else { name }),
        details: truncate(presence.details.as_deref().unwrap_or_default()),
        state: truncate(presence.state.as_deref().unwrap_or_default()),
        started_at,
        ends_at,
        image: asset_url(assets.and_then(|a| a.large_image.as_deref()), application),
        icon: asset_url(assets.and_then(|a| a.small_image.as_deref()), application),
        image_text: truncate(assets.and_then(|a| a.large_text.as_deref()).unwrap_or_default()),
        icon_text: truncate(assets.and_then(|a| a.small_text.as_deref()).unwrap_or_default()),
        party,
    }
}

/// Turns an asset reference into something that can be loaded, or into nothing.
///
/// A game names its artwork in one of four ways. Three of them point at a
/// picture that already exists at a URL, and are simply rewritten. The fourth
/// is a bare key — the name of an image uploaded to the game's own Discord
/// application — which nothing on this machine can resolve, because the only
/// place that knows what the key refers to is Discord.
///
/// That one is passed on as `asset:<application>/<key>` for the Aural server to
/// resolve. It could have been resolved here instead, but that would mean every
/// member's client asking Discord what everyone is playing, from their own
/// address. One server asking once, and serving the answer to everybody, is the
/// same picture without the crowd.
///
/// A reference that could not survive the server's validation is dropped rather
/// than sent. The server refuses a whole activity over one malformed field, so
/// being generous here would cost somebody the text as well as the picture.
fn asset_url(key: Option<&str>, application: &str) -> String {
    let key = key.unwrap_or_default().trim();
    if key.is_empty() {
        return String::new();
    }
    // Already a URL: some games put one straight in.
    if let Some(rest) = key.strip_prefix("https://") {
        let url = format!("https://{rest}");
        return if url.len() <= 512 { url } else { String::new() };
    }
    // A proxied external picture, which is how dynamic art is carried.
    if let Some(rest) = key.strip_prefix("mp:") {
        let url = format!("https://media.discordapp.net/{rest}");
        return if url.len() <= 512 { url } else { String::new() };
    }
    // Album art, from the one integration that names it this way.
    if let Some(rest) = key.strip_prefix("spotify:") {
        let url = format!("https://i.scdn.co/image/{rest}");
        return if url.len() <= 512 { url } else { String::new() };
    }

    // A bare key. Without an application id there is nothing to look it up
    // against, and a key outside the alphabet the server accepts would take
    // the rest of the activity down with it.
    let numeric = !application.is_empty()
        && application.len() <= 25
        && application.bytes().all(|byte| byte.is_ascii_digit());
    let nameable = key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'));
    if numeric && nameable {
        return format!("asset:{application}/{key}");
    }
    String::new()
}

/// Puts a timestamp into seconds.
///
/// The protocol is inconsistent about this: some SDKs send seconds and others
/// milliseconds, and there is no field saying which. The two are told apart by
/// magnitude, which is unambiguous for any date this side of the year 5138.
fn normalise_time(value: Option<i64>) -> i64 {
    let value = value.unwrap_or(0);
    if value <= 0 {
        return 0;
    }
    if value > 100_000_000_000 {
        value / 1000
    } else {
        value
    }
}

/// Cuts a line to what the server accepts, on a character boundary.
fn truncate(value: &str) -> String {
    const MAX: usize = 128;
    let value = value.trim();
    if value.chars().count() <= MAX {
        return value.to_string();
    }
    value.chars().take(MAX - 1).collect::<String>() + "…"
}

// --- platforms ---------------------------------------------------------------

#[cfg(windows)]
#[path = "rpc_windows.rs"]
mod platform;

#[cfg(unix)]
#[path = "rpc_unix.rs"]
mod platform;

#[cfg(not(any(windows, unix)))]
mod platform {
    use super::*;

    pub const SUPPORTED: bool = false;
    pub struct Listener;

    pub fn socket_name() -> String {
        String::new()
    }

    pub fn claim(_socket: &str) -> std::io::Result<Option<Listener>> {
        Ok(None)
    }

    pub fn serve<R: Runtime>(_listener: Listener, _shared: &Arc<Shared<R>>) {}

    pub fn process_name(_pid: u32) -> Option<String> {
        None
    }
}
