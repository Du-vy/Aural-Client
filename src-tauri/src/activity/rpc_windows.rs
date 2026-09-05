//! The rich-presence socket on Windows, where it is a named pipe.
//!
//! Everything here is overlapped rather than blocking, for one reason: the
//! switch that turns this feature off has to actually release the pipe, and a
//! thread parked forever inside `ConnectNamedPipe` cannot be asked to let go.
//! With an event to wait on, every wait has a timeout, and every timeout is a
//! chance to notice that the answer is now no.

use std::io;
use std::os::windows::ffi::OsStrExt;
use std::sync::Arc;

use tauri::Runtime;
use windows::core::{Error as WinError, HRESULT, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_IO_PENDING, ERROR_PIPE_BUSY, ERROR_PIPE_CONNECTED,
    GENERIC_READ, GENERIC_WRITE, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT, WIN32_ERROR,
};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, GetFileVersionInfoSizeW, GetFileVersionInfoW, ReadFile, VerQueryValueW, WriteFile,
    FILE_FLAGS_AND_ATTRIBUTES, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
    FILE_SHARE_NONE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows::Win32::System::Threading::{
    CreateEventW, OpenProcess, QueryFullProcessImageNameW, ResetEvent, WaitForSingleObject,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
    PIPE_WAIT,
};
use windows::Win32::System::IO::{CancelIo, GetOverlappedResult, OVERLAPPED};

use super::Shared;

pub const SUPPORTED: bool = true;

/// How long any single wait parks before looking at the switch again.
const SLICE: u32 = 500;

/// How many pipe instances may exist at once.
///
/// One per connected game, and a launcher plus the game it started is the
/// usual worst case. The ceiling exists so that a process opening connections
/// in a loop runs out of pipe rather than out of memory.
const MAX_INSTANCES: u32 = 8;

/// The name games look for.
///
/// Only index zero is used. A game asks for `0` first and walks upwards, so
/// binding a higher one would mean being found only when something else was
/// already holding the one below — which is exactly the case where the
/// something else is receiving everything anyway.
pub fn socket_name() -> String {
    r"\\.\pipe\discord-ipc-0".to_string()
}

fn wide(value: &str) -> Vec<u16> {
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn is(error: &WinError, code: WIN32_ERROR) -> bool {
    error.code() == HRESULT::from_win32(code.0)
}

/// One pipe instance, and the event every wait on it hangs off.
///
/// The event is shared between reads and writes, which is safe only because a
/// connection is driven by exactly one thread that reads, then writes, then
/// reads again. Nothing here overlaps two operations on one handle.
pub struct Pipe {
    handle: HANDLE,
    event: HANDLE,
}

// A handle is process-wide and this type owns its two exclusively: creating a
// pipe on the supervisor thread and handing it to the thread that will talk on
// it is the whole point.
unsafe impl Send for Pipe {}

impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
            let _ = CloseHandle(self.event);
        }
    }
}

impl Pipe {
    fn create(name: &str, first: bool) -> io::Result<Self> {
        let wide_name = wide(name);
        let mut mode = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
        if first {
            // Refuses rather than quietly adding an instance to somebody
            // else's pipe. Sharing a name would mean games reaching whichever
            // of the two servers happened to have an instance free, which is
            // worse than not being there at all.
            mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
        }

        let handle = unsafe {
            CreateNamedPipeW(
                PCWSTR(wide_name.as_ptr()),
                mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                MAX_INSTANCES,
                MAX_FRAME_BUFFER,
                MAX_FRAME_BUFFER,
                0,
                None,
            )
        };
        if handle.is_invalid() {
            return Err(io::Error::last_os_error());
        }

        let event = unsafe { CreateEventW(None, true, false, None) }
            .map_err(|error| io::Error::other(error))?;
        Ok(Self { handle, event })
    }

    /// Waits for a game to connect. `Ok(false)` means the switch went off first.
    fn accept(&self, keep_going: &dyn Fn() -> bool) -> io::Result<bool> {
        let mut overlapped = OVERLAPPED {
            hEvent: self.event,
            ..Default::default()
        };
        unsafe {
            let _ = ResetEvent(self.event);
        }

        match unsafe { ConnectNamedPipe(self.handle, Some(&mut overlapped)) } {
            Ok(()) => return Ok(true),
            // The client got there between creating the pipe and asking.
            Err(error) if is(&error, ERROR_PIPE_CONNECTED) => return Ok(true),
            Err(error) if is(&error, ERROR_IO_PENDING) => {}
            Err(error) => return Err(io::Error::other(error)),
        }

        loop {
            match unsafe { WaitForSingleObject(self.event, SLICE) } {
                WAIT_OBJECT_0 => return Ok(true),
                WAIT_TIMEOUT => {
                    if keep_going() {
                        continue;
                    }
                    unsafe {
                        let _ = CancelIo(self.handle);
                    }
                    return Ok(false);
                }
                _ => return Err(io::Error::last_os_error()),
            }
        }
    }

    /// Fills `buf` completely. `Ok(false)` means nothing arrived and nothing
    /// was lost, which is the ordinary state of a game that has said its piece.
    fn read_exact(&self, buf: &mut [u8], keep_going: &dyn Fn() -> bool) -> io::Result<bool> {
        let mut filled = 0usize;
        while filled < buf.len() {
            // Once part of a frame has been read there is no going back: a
            // stream framed by length cannot be resynchronised, so the rest is
            // waited for however long it takes.
            let patient = filled > 0;
            match self.read_some(&mut buf[filled..], patient, keep_going)? {
                Some(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
                Some(read) => filled += read,
                None if patient => return Err(io::ErrorKind::UnexpectedEof.into()),
                None => return Ok(false),
            }
        }
        Ok(true)
    }

    fn read_some(
        &self,
        buf: &mut [u8],
        patient: bool,
        keep_going: &dyn Fn() -> bool,
    ) -> io::Result<Option<usize>> {
        let mut overlapped = OVERLAPPED {
            hEvent: self.event,
            ..Default::default()
        };
        unsafe {
            let _ = ResetEvent(self.event);
        }

        let mut read = 0u32;
        match unsafe { ReadFile(self.handle, Some(buf), Some(&mut read), Some(&mut overlapped)) } {
            Ok(()) => return Ok(Some(read as usize)),
            Err(error) if is(&error, ERROR_IO_PENDING) => {}
            Err(error) => return Err(io::Error::other(error)),
        }

        loop {
            match unsafe { WaitForSingleObject(self.event, SLICE) } {
                WAIT_OBJECT_0 => break,
                WAIT_TIMEOUT => {
                    if patient && keep_going() {
                        continue;
                    }
                    // Cancelling races completion, so the result is still
                    // collected: bytes that arrived in the meantime were taken
                    // out of the pipe and would be lost by ignoring them.
                    unsafe {
                        let _ = CancelIo(self.handle);
                    }
                    let mut salvaged = 0u32;
                    let finished = unsafe {
                        GetOverlappedResult(self.handle, &overlapped, &mut salvaged, true)
                    };
                    return match finished {
                        Ok(()) if salvaged > 0 => Ok(Some(salvaged as usize)),
                        _ => Ok(None),
                    };
                }
                _ => return Err(io::Error::last_os_error()),
            }
        }

        let mut done = 0u32;
        unsafe { GetOverlappedResult(self.handle, &overlapped, &mut done, false) }
            .map_err(io::Error::other)?;
        Ok(Some(done as usize))
    }

    /// Writes one framed message: opcode, length, payload.
    fn write_frame(&self, op: u32, payload: &[u8]) -> io::Result<()> {
        let mut frame = Vec::with_capacity(8 + payload.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        frame.extend_from_slice(payload);

        let mut written = 0usize;
        while written < frame.len() {
            let mut overlapped = OVERLAPPED {
                hEvent: self.event,
                ..Default::default()
            };
            unsafe {
                let _ = ResetEvent(self.event);
            }

            let mut wrote = 0u32;
            match unsafe {
                WriteFile(
                    self.handle,
                    Some(&frame[written..]),
                    Some(&mut wrote),
                    Some(&mut overlapped),
                )
            } {
                Ok(()) => {}
                Err(error) if is(&error, ERROR_IO_PENDING) => {
                    // A peer that will not read is a peer to give up on; the
                    // alternative is a thread parked on a full pipe forever.
                    match unsafe { WaitForSingleObject(self.event, 5_000) } {
                        WAIT_OBJECT_0 => {}
                        _ => {
                            unsafe {
                                let _ = CancelIo(self.handle);
                            }
                            return Err(io::ErrorKind::TimedOut.into());
                        }
                    }
                    unsafe { GetOverlappedResult(self.handle, &overlapped, &mut wrote, false) }
                        .map_err(io::Error::other)?;
                }
                Err(error) => return Err(io::Error::other(error)),
            }

            if wrote == 0 {
                return Err(io::ErrorKind::WriteZero.into());
            }
            written += wrote as usize;
        }
        Ok(())
    }
}

/// How much the pipe buffers in each direction.
const MAX_FRAME_BUFFER: u32 = 64 * 1024;

/// The socket, once it is ours, plus the instance claiming it produced.
pub struct Listener {
    name: String,
    first: Option<Pipe>,
}

/// Takes the socket, or reports that somebody else has it.
///
/// The check is a connection attempt rather than a guess: the only authority
/// on whether a pipe exists is the pipe. `Ok(None)` is the answer that matters
/// — it means Discord, or something speaking for it, got there first.
pub fn claim(socket: &str) -> io::Result<Option<Listener>> {
    if taken(socket) {
        return Ok(None);
    }
    match Pipe::create(socket, true) {
        Ok(pipe) => Ok(Some(Listener {
            name: socket.to_string(),
            first: Some(pipe),
        })),
        // Lost the race between looking and creating, which is the same
        // outcome as having lost it before looking.
        Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY.0 as i32) => Ok(None),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => Ok(None),
        Err(error) => Err(error),
    }
}

/// Whether something already answers on that name.
fn taken(socket: &str) -> bool {
    let name = wide(socket);
    let opened = unsafe {
        CreateFileW(
            PCWSTR(name.as_ptr()),
            GENERIC_READ.0 | GENERIC_WRITE.0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            None,
        )
    };
    match opened {
        Ok(handle) => {
            // Connecting consumed one of the holder's instances for an
            // instant. Letting go immediately is the whole of the probe.
            unsafe {
                let _ = CloseHandle(handle);
            }
            true
        }
        // The name exists and every instance is busy, which still means it
        // belongs to somebody.
        Err(error) if is(&error, ERROR_PIPE_BUSY) => true,
        Err(error) if is(&error, ERROR_FILE_NOT_FOUND) => false,
        // Anything else is not evidence of a holder, and treating it as one
        // would mean reporting a conflict that is really a bug here.
        Err(_) => false,
    }
}

/// Accepts games until the switch goes off.
///
/// Nothing else ends this loop, and that is deliberate. Returning would send
/// the supervisor back to `claim`, which probes the socket by connecting to
/// it — and the handler threads still holding instances would answer, so this
/// process would report a conflict against itself. Every other failure is
/// therefore waited out here rather than escalated: an instance that cannot be
/// created because all of them are in use is a busy moment, not a broken one.
pub fn serve<R: Runtime>(mut listener: Listener, shared: &Arc<Shared<R>>) {
    let state = shared.state.clone();
    let keep_going = move || state.games_wanted();

    loop {
        if !keep_going() {
            return;
        }

        let pipe = match listener.first.take() {
            Some(pipe) => pipe,
            None => match Pipe::create(&listener.name, false) {
                Ok(pipe) => pipe,
                Err(_) => {
                    // Every instance is busy, or the system refused for a
                    // moment. Either resolves itself as games disconnect.
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    continue;
                }
            },
        };

        match pipe.accept(&keep_going) {
            Ok(true) => {}
            // The switch went off while waiting.
            Ok(false) => return,
            // This instance broke. Another one costs nothing.
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
        }

        let handler = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("aural-rich-presence-client".into())
            .spawn(move || {
                let state = handler.state.clone();
                let keep_going = move || state.games_wanted();
                super::converse(
                    &handler,
                    |buf| pipe.read_exact(buf, &keep_going),
                    |op, payload| pipe.write_frame(op, payload),
                );
                unsafe {
                    let _ = DisconnectNamedPipe(pipe.handle);
                }
            });
        // A thread that could not be started takes its pipe down with it, so
        // the game sees the connection close and opens another. There is
        // nothing here that a new instance does not fix.
        if spawned.is_err() {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
}

/// The name of the process that reported, which is the only readable name a
/// game offers.
///
/// A rich-presence handshake carries an application id and nothing else.
/// Turning one into a title means asking Discord's API what that id is called,
/// over the network, every time somebody starts a game — which would make a
/// feature about somebody's own computer into a reason to tell a third party
/// what they are playing. The process is right there instead.
pub fn process_name(pid: u32) -> Option<String> {
    let path = process_path(pid)?;
    // The version resource is where an executable keeps the name a person
    // would recognise. `cs2.exe` describes itself as Counter-Strike 2, and
    // that is the line worth showing.
    if let Some(described) = file_description(&path) {
        let described = described.trim();
        if !described.is_empty() {
            return Some(described.to_string());
        }
    }
    std::path::Path::new(&path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
}

fn process_path(pid: u32) -> Option<String> {
    // The limited right is enough to read an image name and is granted for
    // processes this one could not otherwise open.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0u16; 32_768];
    let mut length = buffer.len() as u32;
    let queried = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    unsafe {
        let _ = CloseHandle(process);
    }
    queried.ok()?;
    buffer.truncate(length as usize);
    Some(String::from_utf16_lossy(&buffer))
}

/// Reads `FileDescription` out of an executable's version resource.
fn file_description(path: &str) -> Option<String> {
    let wide_path = wide(path);
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(wide_path.as_ptr()), None) };
    if size == 0 {
        return None;
    }
    let mut block = vec![0u8; size as usize];
    unsafe {
        GetFileVersionInfoW(
            PCWSTR(wide_path.as_ptr()),
            None,
            size,
            block.as_mut_ptr().cast(),
        )
    }
    .ok()?;

    // The strings are filed under the language the resource was written in,
    // which has to be read out of the translation table first.
    let mut translations = std::ptr::null_mut();
    let mut translations_len = 0u32;
    let query = wide(r"\VarFileInfo\Translation");
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr().cast(),
            PCWSTR(query.as_ptr()),
            &mut translations,
            &mut translations_len,
        )
    };
    if !found.as_bool() || translations.is_null() || translations_len < 4 {
        return None;
    }

    // One entry is a language id and a code page, each two bytes.
    let language = unsafe { std::ptr::read_unaligned(translations.cast::<u16>()) };
    let codepage = unsafe { std::ptr::read_unaligned(translations.cast::<u16>().add(1)) };

    let key = wide(&format!(
        r"\StringFileInfo\{language:04x}{codepage:04x}\FileDescription"
    ));
    let mut value = std::ptr::null_mut();
    let mut value_len = 0u32;
    let found = unsafe {
        VerQueryValueW(
            block.as_ptr().cast(),
            PCWSTR(key.as_ptr()),
            &mut value,
            &mut value_len,
        )
    };
    if !found.as_bool() || value.is_null() || value_len == 0 {
        return None;
    }

    let text = unsafe { std::slice::from_raw_parts(value.cast::<u16>(), value_len as usize) };
    let text: Vec<u16> = text.iter().copied().take_while(|unit| *unit != 0).collect();
    Some(String::from_utf16_lossy(&text))
}
