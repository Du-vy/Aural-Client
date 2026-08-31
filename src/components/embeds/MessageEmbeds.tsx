import { classifyUrl } from "@/lib/links";
import { AudioEmbed } from "./AudioEmbed";
import { ImageEmbed } from "./ImageEmbed";
import { OpenGraphEmbed } from "./OpenGraphEmbed";
import { VideoEmbed } from "./VideoEmbed";
import { YouTubeEmbed } from "./YouTubeEmbed";

interface MessageEmbedsProps {
  urls: readonly string[];
  onOpenLink(url: string): void;
}

const MAX_EMBEDS_PER_MESSAGE = 4;

export function MessageEmbeds({ urls, onOpenLink }: MessageEmbedsProps) {
  if (!urls || urls.length === 0) return null;

  const visibleUrls = urls.slice(0, MAX_EMBEDS_PER_MESSAGE);

  return (
    <div className="msg-embeds">
      {visibleUrls.map((url) => {
        const parsed = classifyUrl(url);

        switch (parsed.type) {
          case "image":
            return <ImageEmbed key={url} url={url} onOpenLink={onOpenLink} />;
          case "video":
            return <VideoEmbed key={url} url={url} />;
          case "audio":
            return <AudioEmbed key={url} url={url} />;
          case "youtube":
            return (
              <YouTubeEmbed
                key={url}
                url={url}
                videoId={parsed.videoId!}
                startTime={parsed.startTime}
                onOpenLink={onOpenLink}
              />
            );
          case "general":
            return <OpenGraphEmbed key={url} url={url} onOpenLink={onOpenLink} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
