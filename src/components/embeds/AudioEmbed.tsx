import { useTranslation } from "@/lib/i18n";
import { MusicIcon } from "../Icons";

interface AudioEmbedProps {
  url: string;
}

function getAudioTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments.pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Ignore
  }
  return url;
}

export function AudioEmbed({ url }: AudioEmbedProps) {
  const { t } = useTranslation();
  const title = getAudioTitle(url);

  return (
    <div className="msg-embed msg-embed--audio">
      <div className="msg-embed__audio-head">
        <span className="msg-embed__audio-icon">
          <MusicIcon size={16} />
        </span>
        <span className="msg-embed__audio-title" title={title}>
          {title || t("embeds.audioAttachment")}
        </span>
      </div>
      <audio
        src={url}
        controls
        preload="metadata"
        className="msg-embed__audio-player"
      />
    </div>
  );
}
