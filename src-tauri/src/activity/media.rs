//! What the machine is playing, read off the system's media session.
//!
//! This is the source that costs a player nothing. Windows keeps one session
//! per application that can be driven from the keyboard's media keys, and the
//! same session is what draws the track on the lock screen and in the volume
//! flyout. Spotify, a browser tab, a local player and a game's own soundtrack
//! all populate it without knowing anything about Aural, which is the whole
//! reason to read it rather than to ask anybody to integrate.
//!
//! It is polled rather than subscribed to. The session manager does raise
//! events, but they arrive on a COM apartment this thread would have to keep
//! alive and pumped for the life of the application, and the reward for that
//! is learning about a track change a second earlier. Two seconds of latency
//! on "what is playing" is not a thing anybody can perceive.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Runtime};

use super::{Activity, Source, State};

/// How often the session is read. See the note above: this is not a race.
const POLL: Duration = Duration::from_secs(2);

/// The longest edge of the artwork that is sent on.
///
/// The picture is broadcast to every connected member each time a track
/// changes, so it is re-encoded down to something a member list actually draws
/// rather than passed on at whatever size the player happened to hand over —
/// which for Spotify is 300 pixels square and for a browser can be far more.
const ART_EDGE: u32 = 128;

/// The ceiling the server enforces on `image`, minus room for the rest of the
/// payload. Artwork that somehow lands above it is dropped rather than sent to
/// be refused.
const ART_MAX_CHARS: usize = 23_000;

/// Whether this platform can read a media session, and why not when it cannot.
pub fn support() -> (bool, &'static str) {
    #[cfg(windows)]
    {
        (true, "")
    }
    #[cfg(not(windows))]
    {
        (false, "unsupported_platform")
    }
}

#[cfg(not(windows))]
pub fn start<R: Runtime>(_app: AppHandle<R>, _state: Arc<State>) {
    // Linux would read this over MPRIS and macOS cannot read it at all: the
    // private framework that carries it has needed an entitlement Apple does
    // not grant since Sonoma. Neither is stubbed out with something that
    // half-works — the settings page says the source is unavailable here, and
    // that is a truthful answer rather than a silent one.
}

#[cfg(windows)]
pub fn start<R: Runtime>(app: AppHandle<R>, state: Arc<State>) {
    std::thread::Builder::new()
        .name("aural-media-session".into())
        .spawn(move || windows_impl::run(app, state))
        .ok();
}

#[cfg(windows)]
mod windows_impl {
    use super::*;

    use base64::Engine as _;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{
        CoInitializeEx, COINIT_MULTITHREADED,
    };

    pub fn run<R: Runtime>(app: AppHandle<R>, state: Arc<State>) {
        // WinRT is reached through COM, and a thread that has not joined an
        // apartment cannot make the call at all. Multi-threaded is the right
        // one here: nothing on this thread has a message loop, and the
        // alternative would need one. A thread that is already in an apartment
        // returns an error that is not a failure, so the result is dropped.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let mut manager: Option<Manager> = None;
        // What was last sent, so that a poll which finds nothing new says
        // nothing. Most polls find nothing new.
        let mut last: Option<Activity> = None;
        // The track the artwork on hand belongs to. Decoding a cover is the
        // one expensive thing in this loop, so it happens when the track
        // changes and not once every two seconds.
        let mut art_for = String::new();
        let mut art = String::new();

        loop {
            std::thread::sleep(POLL);

            if !state.media_wanted() {
                if last.take().is_some() {
                    super::super::emit(&app, Source::Media, None);
                }
                // The manager is dropped along with it: the switch being off
                // should leave nothing of this running.
                manager = None;
                art_for.clear();
                art.clear();
                continue;
            }

            if manager.is_none() {
                manager = Manager::RequestAsync().ok().and_then(|op| op.get().ok());
            }
            let Some(held) = manager.as_ref() else {
                continue;
            };

            let next = match read(held, &state, &mut art_for, &mut art) {
                Ok(activity) => activity,
                Err(_) => {
                    // The manager can go stale — a session host dying takes it
                    // with it. Dropping it means the next tick asks for a new
                    // one rather than failing forever against a dead handle.
                    manager = None;
                    continue;
                }
            };

            if next != last {
                super::super::emit(&app, Source::Media, next.clone());
                last = next;
            }
        }
    }

    /// Reads the session that currently has the keyboard's attention.
    ///
    /// Returns `Ok(None)` when there is nothing to report, which covers both
    /// "no player is open" and "a player is open and paused". Paused is not
    /// reported on purpose: a status that stays on the last track somebody
    /// stopped in the middle of, for hours, is worse than no status.
    fn read(
        manager: &Manager,
        state: &Arc<State>,
        art_for: &mut String,
        art: &mut String,
    ) -> windows::core::Result<Option<Activity>> {
        let session = match manager.GetCurrentSession() {
            Ok(session) => session,
            // No session at all is an error from this API rather than an empty
            // answer, and it is the ordinary case on a machine playing nothing.
            Err(_) => return Ok(None),
        };

        let playing = session
            .GetPlaybackInfo()
            .and_then(|info| info.PlaybackStatus())
            .map(|status| status == PlaybackStatus::Playing)
            .unwrap_or(false);
        if !playing {
            return Ok(None);
        }

        let props = match session.TryGetMediaPropertiesAsync() {
            Ok(op) => match op.get() {
                Ok(props) => props,
                Err(_) => return Ok(None),
            },
            Err(_) => return Ok(None),
        };

        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
        // A session with no title is a player that has started but not loaded
        // anything. There is nothing to say about it yet.
        if title.trim().is_empty() {
            return Ok(None);
        }

        let source = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let name = friendly_source(&source);

        let (started_at, ends_at) = timings(&session);

        // The artwork is keyed on the track rather than on the whole activity:
        // a progress bar moving is not a reason to decode a cover again.
        let key = format!("{name}\u{1}{title}\u{1}{artist}");
        if !state.artwork_wanted() {
            art_for.clear();
            art.clear();
        } else if *art_for != key {
            *art_for = key;
            *art = thumbnail(&props).unwrap_or_default();
        }

        Ok(Some(Activity {
            kind: "listening".into(),
            name,
            details: truncate(&title),
            // The album is the better second line when there is one, but the
            // artist is the one people read, so it leads and the album follows
            // it rather than replacing it.
            state: truncate(&join_state(&artist, &album)),
            started_at,
            ends_at,
            image: art.clone(),
            image_text: truncate(&album),
            ..Activity::default()
        }))
    }

    /// Turns a session's position into the pair of timestamps a client counts
    /// between.
    ///
    /// Both are absolute times rather than a duration, because the client
    /// showing them is not the machine that read them: a progress bar has to
    /// keep moving between reports, and it can only do that from a wall clock
    /// it shares with this one.
    fn timings(
        session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
    ) -> (i64, i64) {
        let Ok(timeline) = session.GetTimelineProperties() else {
            return (0, 0);
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // WinRT durations are in ticks of 100 nanoseconds.
        let secs = |span: windows::Foundation::TimeSpan| span.Duration / 10_000_000;
        let position = timeline.Position().map(secs).unwrap_or(0);
        let end = timeline.EndTime().map(secs).unwrap_or(0);
        let start = timeline.StartTime().map(secs).unwrap_or(0);

        if position <= 0 {
            return (0, 0);
        }
        let started_at = now - (position - start).max(0);
        // A stream has no end, and neither does a source that does not fill
        // this in. Either way the client counts up instead of down.
        let ends_at = if end > start {
            started_at + (end - start)
        } else {
            0
        };
        (started_at, ends_at)
    }

    /// Reads the cover the player handed over and re-encodes it small.
    ///
    /// Every step is allowed to fail into "no artwork": a track with a picture
    /// nobody can decode is still a track worth reporting, and this runs on a
    /// background thread where there is nobody to tell.
    fn thumbnail(
        props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<String> {
        let reference = props.Thumbnail().ok()?;
        let stream = reference.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        // Nothing, or something far too big to be a cover: either way this is
        // not a picture worth spending a decode on.
        if size == 0 || size > 8 * 1024 * 1024 {
            return None;
        }

        let input = stream.GetInputStreamAt(0).ok()?;
        let reader = DataReader::CreateDataReader(&input).ok()?;
        reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut raw = vec![0u8; size as usize];
        reader.ReadBytes(&mut raw).ok()?;

        let decoded = image::load_from_memory(&raw).ok()?;
        // `thumbnail` keeps the aspect ratio and is the cheap filter, which is
        // the right trade for a picture that will be drawn at 40 pixels.
        let small = decoded.thumbnail(ART_EDGE, ART_EDGE).to_rgb8();

        let mut encoded = Vec::new();
        let mut encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 80);
        encoder
            .encode(
                small.as_raw(),
                small.width(),
                small.height(),
                image::ExtendedColorType::Rgb8,
            )
            .ok()?;

        let url = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&encoded)
        );
        // The server would refuse it, and being refused is a worse outcome
        // than going without the picture: the refusal takes the text with it.
        if url.len() > ART_MAX_CHARS {
            return None;
        }
        Some(url)
    }

    /// Turns whatever the session calls its host into something worth reading.
    ///
    /// A classic application reports its executable and a packaged one reports
    /// an identifier with the package family in it. Neither is a name, and the
    /// system does not offer one, so this makes the best of what is there and
    /// keeps a short list of the ones that would otherwise read badly.
    fn friendly_source(id: &str) -> String {
        let trimmed = id.trim();

        // The two kinds of identifier are taken apart differently, and it
        // matters which branch a name goes down.
        //
        // A packaged application reports `family!entry`, where the entry is a
        // dotted class name whose last segment is the closest thing to a name
        // in it. A classic application reports its executable, where the only
        // thing to remove is the extension — and where reducing to the last
        // dotted segment would remove the name instead, leaving every player
        // on the machine called "Exe".
        let cleaned = match trimmed.rsplit_once('!') {
            Some((_, entry)) => match entry.rsplit_once('.') {
                Some((_, last)) if !last.is_empty() => last,
                _ => entry,
            },
            None => strip_extension(trimmed),
        };

        let known = [
            ("chrome", "Chrome"),
            ("msedge", "Microsoft Edge"),
            ("firefox", "Firefox"),
            ("brave", "Brave"),
            ("opera", "Opera"),
            ("vivaldi", "Vivaldi"),
            ("spotify", "Spotify"),
            ("vlc", "VLC"),
            ("foobar2000", "foobar2000"),
            ("musicbee", "MusicBee"),
            ("aimp", "AIMP"),
            ("zunemusic", "Media Player"),
            ("winamp", "Winamp"),
            ("tidal", "TIDAL"),
            ("deezer", "Deezer"),
            ("itunes", "iTunes"),
            ("applemusic", "Apple Music"),
        ];
        let folded = cleaned.to_ascii_lowercase();
        for (needle, pretty) in known {
            if folded == needle {
                return pretty.to_string();
            }
        }

        if cleaned.is_empty() {
            return "Media".to_string();
        }
        // Left alone but for the first letter: an executable is usually
        // already the name somebody would write, only in lower case.
        let mut chars = cleaned.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => "Media".to_string(),
        }
    }

    /// Removes a trailing `.exe`, whatever case it was written in.
    ///
    /// Case matters here more than it looks: the media session reports
    /// whatever the application registered, and that is `Spotify.exe` from one
    /// and `AIMP.EXE` from another.
    fn strip_extension(value: &str) -> &str {
        let bytes = value.as_bytes();
        if bytes.len() > 4 && value[value.len() - 4..].eq_ignore_ascii_case(".exe") {
            return &value[..value.len() - 4];
        }
        value
    }

    /// "Artist — Album", or whichever of the two there is.
    fn join_state(artist: &str, album: &str) -> String {
        let artist = artist.trim();
        let album = album.trim();
        match (artist.is_empty(), album.is_empty()) {
            (false, false) if artist != album => format!("{artist} — {album}"),
            (false, _) => artist.to_string(),
            (true, false) => album.to_string(),
            (true, true) => String::new(),
        }
    }

    /// Cuts a line to what the server accepts, on a character boundary.
    ///
    /// The server refuses the whole report over one long field, which would
    /// mean an album with a very long title silently costing somebody the
    /// feature. Cutting here is the difference between a truncated line and
    /// no line at all.
    fn truncate(value: &str) -> String {
        const MAX: usize = 128;
        if value.chars().count() <= MAX {
            return value.to_string();
        }
        value.chars().take(MAX - 1).collect::<String>() + "…"
    }

    #[cfg(test)]
    mod tests {
        use super::friendly_source;

        #[test]
        fn an_executable_keeps_its_name() {
            // The regression this exists for. Reducing to the last dotted
            // segment used to happen before the extension was removed, which
            // left every classic player on the machine called "Exe".
            assert_eq!(friendly_source("Spotify.exe"), "Spotify");
            assert_eq!(friendly_source("foobar2000.exe"), "foobar2000");
            assert_eq!(friendly_source("SomePlayer.exe"), "SomePlayer");
        }

        #[test]
        fn the_extension_goes_whatever_case_it_is_in() {
            assert_eq!(friendly_source("AIMP.EXE"), "AIMP");
            assert_eq!(friendly_source("Spotify.Exe"), "Spotify");
        }

        #[test]
        fn a_dotted_executable_is_left_alone() {
            // Only a packaged identifier is reduced to its last segment. An
            // executable with a dot in its name is still its name.
            assert_eq!(friendly_source("Music.UI.exe"), "Music.UI");
        }

        #[test]
        fn a_packaged_application_is_reduced_to_its_class() {
            assert_eq!(
                friendly_source("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"),
                "Media Player"
            );
            assert_eq!(
                friendly_source("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
                "Spotify"
            );
            assert_eq!(friendly_source("Some.Family_hash!App"), "App");
        }

        #[test]
        fn the_known_names_are_spelled_properly() {
            assert_eq!(friendly_source("chrome.exe"), "Chrome");
            assert_eq!(friendly_source("msedge.exe"), "Microsoft Edge");
            assert_eq!(friendly_source("vlc.exe"), "VLC");
        }

        #[test]
        fn an_unknown_name_only_gains_a_capital() {
            assert_eq!(friendly_source("winamp2029.exe"), "Winamp2029");
        }

        #[test]
        fn nothing_at_all_still_says_something() {
            assert_eq!(friendly_source(""), "Media");
            assert_eq!(friendly_source("   "), "Media");
        }
    }
}
