import { useEffect, useRef, useState } from "react";

import { Avatar } from "@/components/Avatar";
import {
  EyeIcon,
  MaximizeIcon,
  MinimizeIcon,
  MonitorIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  SlidersIcon,
  VoiceIcon,
} from "@/components/Icons";
import { ScreenShareDialog } from "@/components/dialogs/ScreenShareDialog";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import type { Channel } from "@/lib/protocol";
import { useCall } from "@/store/servers";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import { useVoice } from "@/store/voice";

interface StreamStageProps {
  channel: Channel;
}

/**
 * What a voice channel looks like when you open it: who is sharing a screen,
 * and whichever of those screens you have chosen to watch.
 *
 * Nothing here starts arriving on its own. A picture is two orders of
 * magnitude more expensive than a voice, so a channel with three screens in it
 * costs a viewer nothing until they press watch on one — which is also why
 * these are tiles with a button rather than a wall of live video.
 */
export function StreamStage({ channel }: StreamStageProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const permissions = useMyPermissions();

  const callChannelId = useCall((state) => state.self?.channelId ?? null);
  const callServerId = useCall((state) => state.serverId);
  const serverId = useSession((state) => state.serverId);

  const streams = useVoice((state) => state.streams);
  const screens = useVoice((state) => state.screens);
  const watching = useVoice((state) => state.watching);
  const ownScreen = useVoice((state) => state.ownScreen);
  const ownQuality = useVoice((state) => state.ownQuality);
  const screenError = useVoice((state) => state.screenError);
  const screenConfig = useVoice((state) => state.config?.screen);
  const voiceChannelId = useVoice((state) => state.channelId);
  const stopScreen = useVoice((state) => state.stopScreen);
  const watchScreen = useVoice((state) => state.watchScreen);
  // Subscribed to rather than read through the store's own helper: a count
  // that is only looked up while rendering never re-renders when it changes,
  // which is the one thing a viewer count has to do.
  const viewers = useVoice((state) => state.viewers);
  const viewerCount = (userId: number) => viewers.get(userId)?.size ?? 0;

  const [dialog, setDialog] = useState<"share" | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // The call and the channel on screen are not always the same thing: somebody
  // can sit in one server's voice channel while reading another's. Only the
  // channel actually carrying the call has anything live to show.
  const inThisChannel = callChannelId === channel.id && callServerId === serverId;
  const live = inThisChannel && voiceChannelId === channel.id;

  const canStream = has(permissions, Perm.Stream);
  const sharingAllowed = (screenConfig?.enabled ?? false) && canStream;

  const others = live ? [...streams.values()].filter((entry) => entry.userId !== self?.id) : [];
  const sharing = ownScreen !== null;
  const nothing = others.length === 0 && !sharing;

  return (
    <div className="stage">
      <header className="stage__head">
        <span className="stage__title">
          <VoiceIcon size={16} />
          {channel.name}
        </span>
        <span className="stage__spacer" />
        {live && sharingAllowed ? (
          sharing ? (
            <>
              <button
                className="btn btn--ghost"
                onClick={() => setDialog("share")}
                title={t("voice.screen.changeQuality")}
              >
                <SlidersIcon size={15} />
                {ownQuality
                  ? t("voice.screen.qualityLabel", {
                      height: ownQuality.height,
                      framerate: ownQuality.framerate,
                    })
                  : t("voice.screen.changeQuality")}
              </button>
              <button className="btn btn--danger" onClick={() => void stopScreen()}>
                <ScreenShareOffIcon size={15} />
                {t("voice.screen.stop")}
              </button>
            </>
          ) : (
            <button className="btn btn--primary" onClick={() => setDialog("share")}>
              <ScreenShareIcon size={15} />
              {t("voice.screen.share")}
            </button>
          )
        ) : null}
      </header>

      {screenError ? (
        <p className="stage__notice" role="status">
          {t(`voice.screen.error.${screenError}`)}
        </p>
      ) : null}

      {nothing ? (
        <div className="stage__empty">
          <span className="placeholder__icon">
            <MonitorIcon size={30} />
          </span>
          <h2 className="placeholder__title">{t("voice.screen.noStreamsTitle")}</h2>
          <p className="placeholder__body">
            {!live
              ? t("voice.screen.joinFirst")
              : !screenConfig?.enabled
                ? t("voice.screen.disabled")
                : !canStream
                  ? t("voice.screen.notAllowed")
                  : t("voice.screen.noStreams")}
          </p>
        </div>
      ) : (
        <div className={`stage__grid ${expanded !== null ? "stage__grid--focused" : ""}`}>
          {sharing ? (
            <StreamTile
              key="self"
              name={t("voice.screen.preview")}
              stream={ownScreen}
              label={
                ownQuality
                  ? t("voice.screen.qualityLabel", {
                      height: ownQuality.height,
                      framerate: ownQuality.framerate,
                    })
                  : null
              }
              viewers={self ? viewerCount(self.id) : 0}
              expanded={expanded === (self?.id ?? -1)}
              onToggleExpand={() =>
                setExpanded(expanded === (self?.id ?? -1) ? null : (self?.id ?? -1))
              }
            />
          ) : null}

          {others.map((entry) => {
            const user = users.get(entry.userId);
            const stream = screens.get(entry.userId) ?? null;
            const isWatching = watching.has(entry.userId);
            return (
              <StreamTile
                key={entry.userId}
                name={user?.nickname ?? t("common.member")}
                user={user ?? null}
                stream={isWatching ? stream : null}
                label={t("voice.screen.qualityLabel", {
                  height: entry.quality.height,
                  framerate: entry.quality.framerate,
                })}
                hasAudio={entry.audio}
                viewers={viewerCount(entry.userId)}
                watching={isWatching}
                onWatch={() => void watchScreen(entry.userId, !isWatching)}
                expanded={expanded === entry.userId}
                onToggleExpand={() =>
                  setExpanded(expanded === entry.userId ? null : entry.userId)
                }
              />
            );
          })}
        </div>
      )}

      {dialog === "share" ? (
        <ScreenShareDialog live={sharing} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

interface StreamTileProps {
  name: string;
  /** The person behind the stream, for the placeholder shown before watching. */
  user?: { id: number; nickname: string; avatar?: string | null } | null;
  stream: MediaStream | null;
  label?: string | null;
  hasAudio?: boolean;
  viewers: number;
  watching?: boolean;
  onWatch?(): void;
  expanded: boolean;
  onToggleExpand(): void;
}

/** One screen: the picture if it is arriving, and the way to ask for it if not. */
function StreamTile({
  name,
  user,
  stream,
  label,
  hasAudio,
  viewers,
  watching,
  onWatch,
  expanded,
  onToggleExpand,
}: StreamTileProps) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Assigning the same object again would restart playback, which on a live
    // stream is a visible stutter for no reason.
    if (element.srcObject !== stream) element.srcObject = stream;
    if (stream) void element.play().catch(() => {});
  }, [stream]);

  return (
    <div className={`streamtile ${expanded ? "streamtile--expanded" : ""}`}>
      {stream ? (
        <video
          ref={video}
          className="streamtile__video"
          autoPlay
          playsInline
          // The sound of a shared screen arrives on its own track and is played
          // by the same machinery as everybody's voice, so that one person's
          // volume slider governs both. Playing it here as well would be the
          // same audio twice.
          muted
          onDoubleClick={onToggleExpand}
        />
      ) : (
        <div className="streamtile__idle">
          {user ? <Avatar user={user} size="xl" /> : <MonitorIcon size={40} />}
          <p className="streamtile__idle-name">{name}</p>
          {onWatch ? (
            <button className="btn btn--primary" onClick={onWatch}>
              <EyeIcon size={15} />
              {t("voice.screen.watch")}
            </button>
          ) : null}
        </div>
      )}

      <footer className="streamtile__bar">
        <span className="streamtile__name">
          <span className="streamtile__live">{t("voice.screen.live")}</span>
          {name}
        </span>
        {label ? <span className="streamtile__meta">{label}</span> : null}
        {hasAudio ? <span className="streamtile__meta">{t("voice.screen.withAudio")}</span> : null}
        <span className="streamtile__spacer" />
        <span className="streamtile__meta" title={t("voice.screen.viewersTitle")}>
          <EyeIcon size={12} />
          {viewers}
        </span>
        {watching && onWatch ? (
          <button className="iconbtn" onClick={onWatch} title={t("voice.screen.stopWatching")}>
            <ScreenShareOffIcon size={15} />
          </button>
        ) : null}
        {stream ? (
          <button
            className="iconbtn"
            onClick={onToggleExpand}
            title={expanded ? t("voice.screen.shrink") : t("voice.screen.expand")}
            aria-pressed={expanded}
          >
            {expanded ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
