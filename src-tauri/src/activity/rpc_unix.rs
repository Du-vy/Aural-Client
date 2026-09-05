//! The rich-presence socket on Linux and the BSDs, where it is a unix socket.
//!
//! Everything the Windows half needs overlapped I/O for, this gets from the
//! standard library: a listener can be made non-blocking and a stream can be
//! given a read timeout, which is all the switch being turned off ever needs.
//!
//! macOS reaches this file too and the socket half of it works there, but the
//! media session does not — see `media.rs` — so a mac gets games and no music.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::Runtime;

use super::Shared;

pub const SUPPORTED: bool = true;

/// How long a read parks before the switch is looked at again.
const SLICE: Duration = Duration::from_millis(500);

/// Where the socket lives.
///
/// The runtime directory is the right answer and the temporary directory is
/// what every implementation falls back to, in that order, because that is the
/// order the games themselves try.
pub fn socket_name() -> String {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .or_else(|| std::env::var_os("TMPDIR"))
        .or_else(|| std::env::var_os("TMP"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("discord-ipc-0").to_string_lossy().to_string()
}

pub struct Listener {
    inner: UnixListener,
    /// Kept so that the file can be removed on the way out rather than
    /// recomputed from an environment that may have changed underneath.
    path: String,
}

/// Takes the socket, or reports that somebody else has it.
///
/// A path that exists is not evidence of a holder: a process that died without
/// tidying up leaves the file behind, and refusing to start because of one
/// would mean the feature never working again after a crash. So the file is
/// connected to first. Something that answers is a holder; something that
/// refuses is a leftover, and is removed.
pub fn claim(socket: &str) -> std::io::Result<Option<Listener>> {
    match UnixStream::connect(socket) {
        Ok(_) => return Ok(None),
        Err(error) => match error.kind() {
            std::io::ErrorKind::NotFound => {}
            std::io::ErrorKind::ConnectionRefused => {
                let _ = std::fs::remove_file(socket);
            }
            // Anything else — a permission problem, a path that is not a
            // socket — is not something to clear away on a guess.
            _ => return Ok(None),
        },
    }

    let inner = UnixListener::bind(socket)?;
    inner.set_nonblocking(true)?;
    Ok(Some(Listener {
        inner,
        path: socket.to_string(),
    }))
}

/// Accepts games until the switch goes off.
///
/// As on Windows, a failure short of that is waited out rather than escalated:
/// returning would send the supervisor back to `claim`, which probes by
/// connecting — and this process, still holding the socket, would answer and
/// be reported as the conflict.
pub fn serve<R: Runtime>(listener: Listener, shared: &Arc<Shared<R>>) {
    let path = listener.path.clone();
    loop {
        if !shared.state.games_wanted() {
            break;
        }
        match listener.inner.accept() {
            Ok((stream, _)) => {
                if stream.set_read_timeout(Some(SLICE)).is_err() {
                    continue;
                }
                if stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let handler = shared.clone();
                let spawned = std::thread::Builder::new()
                    .name("aural-rich-presence-client".into())
                    .spawn(move || talk(handler, stream));
                // The stream goes with the closure that could not be started,
                // so the game sees a closed connection and opens another.
                if spawned.is_err() {
                    std::thread::sleep(SLICE);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(SLICE);
            }
            Err(_) => std::thread::sleep(SLICE),
        }
    }
    // The socket is a file, and one left behind is what the next start has to
    // decide whether to trust. Removing it is the tidy half of that bargain.
    drop(listener);
    let _ = std::fs::remove_file(path);
}

fn talk<R: Runtime>(shared: Arc<Shared<R>>, stream: UnixStream) {
    let mut reader = match stream.try_clone() {
        Ok(cloned) => cloned,
        Err(_) => return,
    };
    let mut writer = stream;

    super::converse(
        &shared,
        |buf| read_exact(&mut reader, buf),
        |op, payload| {
            let mut frame = Vec::with_capacity(8 + payload.len());
            frame.extend_from_slice(&op.to_le_bytes());
            frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            frame.extend_from_slice(payload);
            writer.write_all(&frame)
        },
    );
}

/// Fills `buf`. `Ok(false)` means nothing arrived and nothing was lost.
///
/// Once part of a frame has been read the rest is waited for however long it
/// takes: a stream framed by length cannot be resynchronised, so a partial
/// read that gave up would leave the connection unusable rather than idle.
fn read_exact(stream: &mut UnixStream, buf: &mut [u8]) -> std::io::Result<bool> {
    let mut filled = 0usize;
    while filled < buf.len() {
        match stream.read(&mut buf[filled..]) {
            // The peer closed. Part-way through a frame or not, there is
            // nothing left to read and no way to resynchronise.
            Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            Ok(read) => filled += read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                if filled == 0 {
                    return Ok(false);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(true)
}

/// The name of the process that reported.
///
/// `/proc` carries it on Linux and does not exist on macOS or the BSDs, where
/// the activity keeps whatever name the handshake gave it.
pub fn process_name(pid: u32) -> Option<String> {
    let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let comm = comm.trim();
    if comm.is_empty() {
        return None;
    }
    let mut chars = comm.chars();
    let first = chars.next()?;
    Some(first.to_uppercase().collect::<String>() + chars.as_str())
}
