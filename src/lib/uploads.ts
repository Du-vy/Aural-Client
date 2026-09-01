/**
 * File attachments: sending them, addressing them, and deciding how one should
 * be shown.
 *
 * Attachments do not travel over the WebSocket. A file does not fit the frame
 * budget the socket is tuned for, and going over HTTP is what gives an upload a
 * progress bar and a download range requests, seeking and ordinary browser
 * caching. The two halves meet at an id: `POST /upload` returns one, and
 * `message.send` names it.
 */

import type { ServerAddress } from "./address";
import { AuralError, type Attachment, type ProtocolError } from "./protocol";

/** How a file is rendered in a message. */
export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "text" | "file";

/**
 * Text formats worth previewing inline. A file whose content is prose or code
 * is more useful shown than described, and unlike an image it costs a fetch, so
 * the list is deliberately narrow and the preview deliberately bounded.
 */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "csv", "tsv", "json", "yaml", "yml", "toml",
  "ini", "conf", "xml", "sql", "diff", "patch", "go", "rs", "py", "js", "ts",
  "jsx", "tsx", "c", "h", "cpp", "hpp", "cs", "java", "kt", "rb", "php", "sh",
  "bat", "ps1", "css", "lua", "swift", "zig",
]);

/** Extensions that are markdown, which gets a richer preview than plain text. */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/** The file extension, lowercased, or an empty string when there is none. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Decides how a file is shown.
 *
 * The server settles the content type from the extension and never trusts what
 * the uploader claimed, so trusting it here is trusting the server rather than
 * whoever sent the file.
 */
export function attachmentKind(attachment: Attachment): AttachmentKind {
  const type = attachment.contentType;
  // An SVG is served as a download so a browser navigating to it cannot run
  // what is inside; inside an <img> it is just a picture, which is where it is
  // shown.
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain" && TEXT_EXTENSIONS.has(extensionOf(attachment.filename))) return "text";
  // .ogg carries audio far more often than video, and a player probes it
  // either way, so the ambiguous container is offered as audio.
  if (type === "application/ogg") return "audio";
  return "file";
}

/** Whether a text attachment should be rendered as markdown rather than raw. */
export function isMarkdown(attachment: Attachment): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(attachment.filename));
}

/**
 * The absolute URL of an attachment.
 *
 * The server sends a root-relative path, so a client that reached it by
 * address, by hostname or through a reverse proxy all resolve the same working
 * link from the address they already hold.
 */
export function attachmentUrl(address: ServerAddress | null, attachment: Attachment): string {
  if (!address) return attachment.url;
  const scheme = address.secure ? "https" : "http";
  const host = address.host.includes(":") && !address.host.startsWith("[")
    ? `[${address.host}]`
    : address.host;
  return `${scheme}://${host}:${address.port}${attachment.url}`;
}

/**
 * The URL that saves a file rather than showing it. The server answers it with
 * an attachment disposition, which is what turns a click into a download even
 * for a type the browser would happily render.
 */
export function downloadUrl(address: ServerAddress | null, attachment: Attachment): string {
  return `${attachmentUrl(address, attachment)}?download=1`;
}

/** Renders a byte count the way a person reads one. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below ten, none above: "1.4 MB" is worth saying, "847.3 MB" is
  // false precision.
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Reads one of the decimal byte counts the protocol carries as a string. */
export function parseBytes(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface UploadOptions {
  address: ServerAddress;
  /** The session token this device holds, the same one auth.token resumes with. */
  token: string;
  channelId: number;
  file: File;
  onProgress?(fraction: number): void;
}

/** A running upload, which the composer keeps so it can be cancelled. */
export interface RunningUpload {
  done: Promise<Attachment>;
  cancel(): void;
}

/** The endpoint one file is posted to. */
function uploadEndpoint(address: ServerAddress, channelId: number): string {
  const scheme = address.secure ? "https" : "http";
  const host = address.host.includes(":") && !address.host.startsWith("[")
    ? `[${address.host}]`
    : address.host;
  return `${scheme}://${host}:${address.port}/upload?channel=${channelId}`;
}

/**
 * Uploads one file.
 *
 * XMLHttpRequest rather than fetch, for the one thing fetch still cannot do:
 * report how far a request body has been sent. Without that a large file is a
 * spinner for a minute, which is indistinguishable from a client that hung.
 *
 * Where there is no XMLHttpRequest at all — outside a browser, which is where
 * the end-to-end check runs — it falls back to fetch and simply reports no
 * progress. The upload is the part that has to work everywhere; the bar is a
 * courtesy the browser can afford.
 */
export function uploadFile(options: UploadOptions): RunningUpload {
  if (typeof XMLHttpRequest === "undefined") {
    return uploadWithFetch(options);
  }

  const { address, token, channelId, file, onProgress } = options;

  const request = new XMLHttpRequest();
  const url = uploadEndpoint(address, channelId);

  const done = new Promise<Attachment>((resolve, reject) => {
    request.open("POST", url, true);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    // The boundary has to be the one the browser generates, so Content-Type is
    // deliberately not set here: setting it would send a boundary that does not
    // match the body.
    request.responseType = "text";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status === 201) {
        try {
          resolve(JSON.parse(request.responseText) as Attachment);
        } catch {
          reject(new Error("The server accepted the file but described it oddly."));
        }
        return;
      }
      reject(errorFromBody(request.responseText, request.status));
    };

    request.onerror = () => reject(new Error("The file could not be sent."));
    request.onabort = () => reject(new UploadCancelled());
    request.ontimeout = () => reject(new Error("The upload timed out."));

    const body = new FormData();
    body.append("file", file, file.name);
    request.send(body);
  });

  return { done, cancel: () => request.abort() };
}

/** The fetch path, for anywhere XMLHttpRequest does not exist. */
function uploadWithFetch(options: UploadOptions): RunningUpload {
  const { address, token, channelId, file } = options;
  const controller = new AbortController();

  const body = new FormData();
  body.append("file", file, file.name);

  const done = (async () => {
    let response: Response;
    try {
      response = await fetch(uploadEndpoint(address, channelId), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new UploadCancelled();
      throw new Error("The file could not be sent.");
    }

    if (response.status !== 201) {
      const raw = await response.text();
      throw errorFromBody(raw, response.status);
    }
    return (await response.json()) as Attachment;
  })();

  return { done, cancel: () => controller.abort() };
}

/** Thrown when an upload was cancelled deliberately, which is not a failure. */
export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelled";
  }
}

export interface MediaUploadOptions {
  address: ServerAddress;
  token: string;
  file: File;
  onProgress?(fraction: number): void;
}

export interface MediaUploadResult {
  url: string;
  user?: import("./protocol").User;
}

export interface RunningMediaUpload {
  done: Promise<MediaUploadResult>;
  cancel(): void;
}

function mediaUploadEndpoint(address: ServerAddress, type: "avatar" | "banner"): string {
  const scheme = address.secure ? "https" : "http";
  const host = address.host.includes(":") && !address.host.startsWith("[")
    ? `[${address.host}]`
    : address.host;
  return `${scheme}://${host}:${address.port}/upload/${type}`;
}

export function uploadAvatar(options: MediaUploadOptions): RunningMediaUpload {
  return uploadMediaFile(options, "avatar");
}

export function uploadBanner(options: MediaUploadOptions): RunningMediaUpload {
  return uploadMediaFile(options, "banner");
}

function uploadMediaFile(options: MediaUploadOptions, type: "avatar" | "banner"): RunningMediaUpload {
  const { address, token, file, onProgress } = options;
  const url = mediaUploadEndpoint(address, type);

  if (typeof XMLHttpRequest === "undefined") {
    const controller = new AbortController();
    const body = new FormData();
    body.append("file", file, file.name);

    const done = (async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body,
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw new UploadCancelled();
        throw new Error("The file could not be sent.");
      }

      if (response.status < 200 || response.status >= 300) {
        const raw = await response.text();
        throw errorFromBody(raw, response.status);
      }
      return (await response.json()) as MediaUploadResult;
    })();

    return { done, cancel: () => controller.abort() };
  }

  const request = new XMLHttpRequest();
  const done = new Promise<MediaUploadResult>((resolve, reject) => {
    request.open("POST", url, true);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.responseType = "text";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText) as MediaUploadResult);
        } catch {
          reject(new Error("The server accepted the file but described it oddly."));
        }
        return;
      }
      reject(errorFromBody(request.responseText, request.status));
    };

    request.onerror = () => reject(new Error("The file could not be sent."));
    request.onabort = () => reject(new UploadCancelled());
    request.ontimeout = () => reject(new Error("The upload timed out."));

    const body = new FormData();
    body.append("file", file, file.name);
    request.send(body);
  });

  return { done, cancel: () => request.abort() };
}

/**
 * Turns a failed upload into the same error type the WebSocket raises, so one
 * table of error codes covers both halves of the protocol.
 */
function errorFromBody(text: string, status: number): Error {
  try {
    const body = JSON.parse(text) as { error?: ProtocolError };
    if (body.error?.code) return new AuralError(body.error);
  } catch {
    // A body that is not the JSON the server promises leaves only the status.
  }
  if (status === 0) return new Error("The server could not be reached.");
  return new Error(`The server answered ${status}.`);
}
