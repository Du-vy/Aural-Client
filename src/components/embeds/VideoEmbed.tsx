interface VideoEmbedProps {
  url: string;
}

export function VideoEmbed({ url }: VideoEmbedProps) {
  return (
    <div className="msg-embed msg-embed--video">
      <video
        src={url}
        controls
        preload="metadata"
        playsInline
        className="msg-embed__video"
      />
    </div>
  );
}
