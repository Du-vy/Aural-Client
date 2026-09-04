/**
 * The icon set, inlined as SVG so the client ships no icon font and no network
 * request. Every icon inherits `currentColor` and sizes from its `size` prop.
 */

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function icon(path: React.ReactNode, viewBox = "0 0 24 24") {
  return function Icon({ size = 18, className, style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={{ verticalAlign: "middle", ...style }}
        aria-hidden="true"
        focusable="false"
      >
        {path}
      </svg>
    );
  };
}


export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </>,
);

export const SmileyIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <line x1="9" y1="9.5" x2="9.01" y2="9.5" />
    <line x1="15" y1="9.5" x2="15.01" y2="9.5" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
  </>,
);

export const HashIcon = icon(
  <>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </>,
);

export const VoiceIcon = icon(
  <>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </>,
);

export const ChevronIcon = icon(<polyline points="6 9 12 15 18 9" />);

export const PlusIcon = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
);

export const GearIcon = icon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);

export const LogOutIcon = icon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>,
);

export const UsersIcon = icon(
  <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

export const TrashIcon = icon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>,
);

export const CloseIcon = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
);

export const ShieldIcon = icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);

/** The mark of whoever owns the server, which no role carries. */
export const CrownIcon = icon(
  <>
    <path d="M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-1.8 11H4.8L3 7z" />
    <line x1="4.8" y1="18" x2="19.2" y2="18" />
  </>,
);

export const KeyIcon = icon(
  <>
    <path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7-7 5 5 0 0 1 7 7zm0 0L15 8m0 0l3 3 3-3-3-3" />
  </>,
);

export const MenuIcon = icon(
  <>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </>,
);

export const HangUpIcon = icon(
  <>
    <path d="M2 9.5a15 15 0 0 1 20 0v3l-4.5 1-1-3a12 12 0 0 0-9 0l-1 3-4.5-1z" />
    <line x1="3" y1="21" x2="21" y2="3" />
  </>,
);

export const PencilIcon = icon(
  <>
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </>,
);

export const CameraIcon = icon(
  <>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </>,
);

export const FolderIcon = icon(
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
);

export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);

export const UserIcon = icon(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);

export const UserXIcon = icon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="18" y1="8" x2="23" y2="13" />
    <line x1="23" y1="8" x2="18" y2="13" />
  </>,
);

export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>,
);

export const ExternalLinkIcon = icon(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </>,
);

export const PlayIcon = icon(
  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />,
);

export const YouTubeIcon = ({ size = 18, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={style}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export const MusicIcon = icon(
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>,
);

export const ImageIcon = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>,
);

export const AlertTriangleIcon = icon(
  <>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>,
);

export const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);

// The three-lobed rotor that has stood for a webhook since the shape was
// borrowed from the automation tools: one trigger, three places it can go.
export const WebhookIcon = icon(
  <>
    <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
    <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
    <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
  </>,
);

export const PaperclipIcon = icon(
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
);

export const DownloadIcon = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </>,
);

export const HeartIcon = icon(
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
);

export const RepeatIcon = icon(
  <>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </>,
);

export const MessageSquareIcon = icon(
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
);

export const EyeIcon = icon(
  <>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const FileIcon = icon(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </>,
);

export const FileTextIcon = icon(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </>,
);

export const FilmIcon = icon(
  <>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="7" y1="4" x2="7" y2="20" />
    <line x1="17" y1="4" x2="17" y2="20" />
    <line x1="2" y1="12" x2="22" y2="12" />
  </>,
);

export const ArchiveIcon = icon(
  <>
    <rect x="2" y="4" width="20" height="5" rx="1" />
    <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
    <line x1="10" y1="13" x2="14" y2="13" />
  </>,
);

export const ChevronUpIcon = icon(<polyline points="18 15 12 9 6 15" />);

export const ChevronRightIcon = icon(<polyline points="9 18 15 12 9 6" />);

export const ChevronLeftIcon = icon(<polyline points="15 18 9 12 15 6" />);

export const CalendarIcon = icon(
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
    <line x1="3" y1="9.5" x2="21" y2="9.5" />
    <line x1="8" y1="2.5" x2="8" y2="6" />
    <line x1="16" y1="2.5" x2="16" y2="6" />
  </>,
);

export const SlidersIcon = icon(
  <>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="9" cy="7" r="2.5" />
    <circle cx="16" cy="17" r="2.5" />
  </>,
);

export const MicIcon = icon(
  <>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </>,
);

export const VolumeIcon = icon(
  <>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </>,
);

export const MicOffIcon = icon(
  <>
    <line x1="2" y1="2" x2="22" y2="22" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M19 10v2a7 7 0 0 1-.11 1.23M5 10v2a7 7 0 0 0 12 5" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </>,
);

export const HeadphonesIcon = icon(
  <>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </>,
);

export const HeadphonesOffIcon = icon(
  <>
    <line x1="2" y1="2" x2="22" y2="22" />
    <path d="M3 18v-6a9 9 0 0 1 13.4-7.83M21 15v3" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
  </>,
);

export const BroadcastIcon = icon(
  <>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
  </>,
);

export const MonitorIcon = icon(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </>,
);

export const PaletteIcon = icon(
  <>
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </>,
);

export const BellIcon = icon(
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </>,
);

export const BellOffIcon = icon(
  <>
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
    <path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14" />
    <path d="M18 8a6 6 0 0 0-9.33-5" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </>,
);

export const LockIcon = icon(
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);

export const SparklesIcon = icon(
  <>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
  </>,
);

export const CheckIcon = icon(<polyline points="20 6 9 17 4 12" />);

export const SortIcon = icon(
  <>
    <line x1="4" y1="7" x2="14" y2="7" />
    <line x1="4" y1="12" x2="12" y2="12" />
    <line x1="4" y1="17" x2="10" y2="17" />
    <polyline points="16 14 19 17 22 14" />
    <line x1="19" y1="6" x2="19" y2="17" />
  </>,
);

/** A jump into the conversation a search result came from. */
export const JumpIcon = icon(
  <>
    <polyline points="15 10 20 15 15 20" />
    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
  </>,
);

export const UploadIcon = icon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </>,
);

export const RotateCcwIcon = icon(
  <>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </>,
);

export const GifIcon = ({ size = 18, className, style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2" y="4" width="20" height="16" rx="4" />
    <path d="M8.5 9h-2a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 6.5 15h2v-2.5h-1" />
    <path d="M12 9v6" />
    <path d="M15.5 15v-6h3" />
    <path d="M15.5 12h2" />
  </svg>
);

export const StickerIcon = icon(
  <>
    <path d="M15 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-8l-5-7z" />
    <path d="M14 3v5a2 2 0 0 0 2 2h5" />
    <circle cx="8.5" cy="13.5" r=".75" fill="currentColor" />
    <circle cx="12.5" cy="13.5" r=".75" fill="currentColor" />
    <path d="M8.5 16.5a2.5 2.5 0 0 0 4 0" />
  </>,
);

export const TrendingIcon = icon(
  <>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </>,
);

export const AuralMark = ({ size = 26 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.1}
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
  >
    {/* A row of level bars: the shortest thing that reads as sound. */}
    <line x1="4" y1="10" x2="4" y2="14" />
    <line x1="9" y1="6" x2="9" y2="18" />
    <line x1="14" y1="3" x2="14" y2="21" />
    <line x1="19" y1="8" x2="19" y2="16" />
  </svg>
);

export const UploadCloudIcon = icon(
  <>
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
    <path d="M12 12v9" />
    <path d="m8 16 4-4 4 4" />
  </>,
);

export const AccessibilityIcon = icon(
  <>
    <circle cx="12" cy="4" r="2" />
    <path d="M4 8.5h16" />
    <path d="M12 8.5V14" />
    <path d="M12 14l-3.5 6.5" />
    <path d="M12 14l3.5 6.5" />
  </>,
);

export const MegaphoneIcon = icon(
  <>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </>,
);

export const ForumIcon = icon(
  <>
    <path d="M21 16a2 2 0 0 1-2 2H7l-4 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <line x1="8" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="13" y2="14" />
  </>,
);

export const MediaIcon = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </>,
);

export const PinIcon = icon(
  <>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z" />
  </>,
);

export const PinOffIcon = icon(
  <>
    <line x1="2" y1="2" x2="22" y2="22" />
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24V17h12" />
    <path d="M15 9.34V6h1a1 1 0 0 0 0-2H8" />
  </>,
);

export const UnlockIcon = icon(
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </>,
);

export const MapPinIcon = icon(
  <>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </>,
);

export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>,
);

export const CheckCircleIcon = icon(
  <>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </>,
);

export const HelpCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>,
);

export const XCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </>,
);

export const GridIcon = icon(
  <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </>,
);

export const ListIcon = icon(
  <>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </>,
);

export const SendIcon = icon(
  <>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </>,
);





/** The soundboard: a grid of pads, which is what the panel actually is. */
export const SoundboardIcon = icon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
);

/** A gavel, for the moderation screens. */
export const GavelIcon = icon(
  <>
    <path d="M13.5 4.5 19.5 10.5" />
    <path d="M10.5 7.5 16.5 13.5" />
    <path d="m3 21 6-6" />
    <path d="M12 6 6 12" />
    <path d="M18 12 12 18" />
  </>,
);

/** A funnel, for the automatic moderation rules. */
export const FilterIcon = icon(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />);

/** Scissors, for the trimmer. */
export const ScissorsIcon = icon(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </>,
);

/** A square stop button, for cutting a preview short. */
export const StopIcon = icon(<rect x="6" y="6" width="12" height="12" rx="2" />);
