//! The microphone permission the embedded browser asks for, answered here
//! instead of on screen.
//!
//! A page that calls `getUserMedia` inside WebView2 or WebKitGTK gets the
//! engine's own permission UI. On Windows that is a grey bar which drops over
//! the top of the window, in a font that is not ours, naming the application by
//! its executable, and arriving halfway through joining a call. It is the
//! browser asking on behalf of a page that is our own application, in a window
//! that is our own application, and there is nothing for the person reading it
//! to decide that they did not already decide by clicking the channel.
//!
//! So the request is granted here and never shown. Every desktop chat
//! application does the same; it is why joining a call in one of them is one
//! click rather than two.
//!
//! What this does not do is take anything the operating system is holding back.
//! macOS still asks once, through TCC, and that prompt is the real one. Windows
//! still honours its microphone privacy setting. A device already held by
//! something else is still refused. The failures the client reports come from
//! those and are unaffected by any of this; what is removed is a second prompt,
//! from the browser engine inside our own window, about our own page.
//!
//! Two rules keep that defensible, and both are enforced below: only the
//! microphone is ever granted — camera, geolocation and the rest keep the
//! default prompt — and only when the page asking is ours. The client embeds
//! third-party frames, a YouTube player among them, and none of them get a
//! microphone by virtue of sitting inside our window.

/// Whether a URI is the client's own page rather than something embedded in it.
///
/// Tauri serves the application from `tauri.localhost` in a bundle and from
/// `localhost` under `npm run tauri dev`, and nothing else is ever the client.
#[allow(dead_code)]
fn is_own_page(uri: &str) -> bool {
    let Some((scheme, rest)) = uri.split_once("://") else {
        return false;
    };
    if !matches!(scheme, "http" | "https" | "tauri") {
        return false;
    }

    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // `http://tauri.localhost@example.com/` is a page on example.com, and a
    // check that looked for our host anywhere in the string would be fooled by
    // it. The host is what follows the last `@`.
    let host = authority.rsplit('@').next().unwrap_or("");
    // A port is stripped; the last colon of `[::1]` is not a port separator,
    // which is what the digit test distinguishes.
    let host = match host.rsplit_once(':') {
        Some((head, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => head,
        _ => host,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');

    matches!(host, "tauri.localhost" | "localhost" | "127.0.0.1" | "::1")
}

/// Grants microphone requests from the client's own page without prompting.
#[cfg(windows)]
pub fn allow_microphone(webview: &tauri::webview::PlatformWebview) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
    use windows::core::PWSTR;

    let core = match unsafe { webview.controller().CoreWebView2() } {
        Ok(core) => core,
        Err(err) => {
            // Not fatal. Without the handler WebView2 shows its own bar, which
            // is the behaviour this replaces rather than the behaviour it
            // depends on, so the call still works.
            eprintln!("aural: WebView2 core unavailable, the microphone will prompt: {err}");
            return;
        }
    };

    let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
        let Some(args) = args else {
            return Ok(());
        };

        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
        unsafe { args.PermissionKind(&mut kind)? };
        if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
            // Anything else keeps WebView2's default, which is to ask.
            return Ok(());
        }

        let uri = unsafe {
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            take_pwstr(uri)
        };
        if !is_own_page(&uri) {
            return Ok(());
        }

        unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
        Ok(())
    }));

    // wry has already registered a handler of its own, for clipboard reads.
    // WebView2 invokes every registered handler and each may set the state, so
    // one that only ever touches the microphone leaves that one alone.
    let mut token = 0i64;
    if let Err(err) = unsafe { core.add_PermissionRequested(&handler, &mut token) } {
        eprintln!("aural: could not answer microphone permission requests: {err}");
    }
}

/// Grants microphone requests from the client's own page without prompting.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub fn allow_microphone(webview: &tauri::webview::PlatformWebview) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{
        PermissionRequestExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
    };

    webview.inner().connect_permission_request(|view, request| {
        let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
            return false;
        };
        // A request for both is a request for the camera as well, and the
        // camera is not ours to grant.
        if !media.is_for_audio_device() || media.is_for_video_device() {
            return false;
        }
        // WebKitGTK does not say which frame asked, only what the view is
        // showing, so unlike the Windows path this is a check on the page and
        // not on the frame. It still rules out a view that has navigated
        // somewhere it should not have.
        if !view.uri().is_some_and(|uri| is_own_page(uri.as_str())) {
            return false;
        }
        media.allow();
        true
    });
}

/// On macOS and iOS WKWebView answers this itself, with a native sheet.
///
/// Silencing that one means installing a `WKUIDelegate` method onto a class wry
/// owns and shares across every webview in the process. The prize is small —
/// WebKit's prompt is a real system dialog, not a bar wedged into the page —
/// and the real macOS prompt, the one TCC shows, would still be there. So it is
/// left alone deliberately rather than by omission.
#[cfg(not(any(
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
pub fn allow_microphone(_webview: &tauri::webview::PlatformWebview) {}

#[cfg(test)]
mod tests {
    use super::is_own_page;

    #[test]
    fn accepts_the_pages_the_client_is_served_from() {
        assert!(is_own_page("http://tauri.localhost/"));
        assert!(is_own_page("https://tauri.localhost/index.html"));
        assert!(is_own_page("http://localhost:5173/"));
        assert!(is_own_page("http://127.0.0.1:5173/?x=1"));
        assert!(is_own_page("http://[::1]:5173/"));
        assert!(is_own_page("tauri://localhost"));
    }

    #[test]
    fn rejects_everything_embedded_in_them() {
        assert!(!is_own_page("https://www.youtube.com/embed/x"));
        assert!(!is_own_page("https://tauri.localhost.example.com/"));
        assert!(!is_own_page("https://example.com/tauri.localhost"));
        assert!(!is_own_page("about:blank"));
        assert!(!is_own_page(""));
    }

    #[test]
    fn is_not_fooled_by_userinfo() {
        assert!(!is_own_page("http://tauri.localhost@example.com/"));
        assert!(!is_own_page("http://localhost:5173@example.com/"));
    }
}
