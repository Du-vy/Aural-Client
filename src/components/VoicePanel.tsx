import { useTranslation } from "@/lib/i18n";
import { canOpenPrivacySettings, openPrivacySettings } from "@/lib/open";
import { useSession } from "@/store/session";
import { useVoice } from "@/store/voice";
import {
  BroadcastIcon,
  GearIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  VoiceIcon,
} from "./Icons";

interface VoicePanelProps {
  onOpenVoiceSettings(): void;
}

/**
 * The strip above the user panel, shown only while this client is in a voice
 * channel.
 *
 * It answers the three questions somebody in a call actually has — am I
 * connected, who is carrying this, and how do I get out — and puts mute and
 * deafen where a hand already is. Everything finer lives in settings.
 */
export function VoicePanel({ onOpenVoiceSettings }: VoicePanelProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const channels = useSession((state) => state.channels);
  const users = useSession((state) => state.users);
  const leaveChannel = useSession((state) => state.leaveChannel);

  const status = useVoice((state) => state.status);
  const notice = useVoice((state) => state.notice);
  const micError = useVoice((state) => state.micError);
  const carriesAudio = useVoice((state) => state.config?.enabled ?? false);
  const mode = useVoice((state) => state.mode);
  const hostUserId = useVoice((state) => state.hostUserId);
  const states = useVoice((state) => state.states);
  const toggleMute = useVoice((state) => state.toggleMute);
  const toggleDeafen = useVoice((state) => state.toggleDeafen);
  const retryMicrophone = useVoice((state) => state.retryMicrophone);

  // The channel comes from presence rather than from the voice store, so this
  // strip appears the moment somebody is in a voice channel — including on a
  // server that carries no audio, where sitting in one is all there is.
  const channelId = self?.channelId ?? null;
  const channel = channelId === null ? null : channels.get(channelId);
  if (!self || !channel || channel.type !== "voice") return null;

  const own = states.get(self.id);
  const muted = own ? own.selfMute || own.mute : false;
  const deafened = own ? own.selfDeaf || own.deaf : false;

  // A server can have voice channels and no audio plane at all, and somebody
  // sitting in one of those channels is not in a call that is failing. They
  // are in a channel, and that is all this can honestly say.
  const statusLabel = !carriesAudio
    ? t("errors.voice_disabled")
    : status === "connected"
      ? t("voice.connected")
      : status === "connecting"
        ? t("voice.connecting")
        : status === "reconnecting"
          ? t("voice.reconnecting")
          : status === "failed"
            ? t("voice.failed")
            : t("voice.idle");

  const hostName =
    hostUserId === null
      ? null
      : hostUserId === self.id
        ? null
        : (users.get(hostUserId)?.nickname ?? null);

  const relayLabel = !carriesAudio
    ? null
    : mode === "server_host"
      ? t("voice.modeServer")
      : hostUserId === self.id
        ? t("voice.modeClientSelf")
        : hostName
          ? t("voice.modeClient", { name: hostName })
          : null;

  return (
    <div className={`voicepanel voicepanel--${carriesAudio ? status : "off"}`}>
      <div className="voicepanel__head">
        <span className="voicepanel__dot" aria-hidden="true" />
        <span className="voicepanel__body">
          <span className="voicepanel__status">{statusLabel}</span>
          <span className="voicepanel__channel">
            <VoiceIcon size={12} />
            {channel.name}
          </span>
        </span>
        <button
          className="iconbtn iconbtn--danger"
          onClick={() => void leaveChannel()}
          title={t("voice.disconnect")}
          aria-label={t("voice.disconnect")}
        >
          <HangUpIcon size={17} />
        </button>
      </div>

      {relayLabel ? (
        <p className="voicepanel__relay">
          <BroadcastIcon size={11} />
          {relayLabel}
        </p>
      ) : null}

      {micError ? (
        <div className="voicepanel__mic" role="status">
          <p className="voicepanel__mic-title">{t(`voice.mic.${micError}`)}</p>
          <p className="voicepanel__mic-help">
            {micError === "denied"
              ? canOpenPrivacySettings()
                ? t("voice.mic.deniedHelpNative")
                : t("voice.mic.deniedHelpBrowser")
              : t(`voice.mic.${micError}Help`)}
          </p>
          {/* What it actually means to be here, which is easy to miss. */}
          <p className="voicepanel__mic-help">{t("voice.mic.listening")}</p>
          <div className="voicepanel__mic-actions">
            <button
              type="button"
              className="voicepanel__mic-btn voicepanel__mic-btn--primary"
              onClick={() => void retryMicrophone()}
            >
              {t("voice.mic.retry")}
            </button>
            {micError === "denied" && canOpenPrivacySettings() ? (
              <button
                type="button"
                className="voicepanel__mic-btn"
                onClick={() => void openPrivacySettings()}
              >
                {t("voice.mic.openSettings")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {notice ? <p className="voicepanel__notice">{notice}</p> : null}

      {carriesAudio ? (
        <div className="voicepanel__actions">
          <button
            className={muted ? "iconbtn iconbtn--danger" : "iconbtn"}
            onClick={() => void toggleMute()}
            disabled={own?.mute && !own.selfMute}
            title={
              own?.mute && !own.selfMute
                ? t("voice.mutedByServer")
                : muted
                  ? t("voice.unmute")
                  : t("voice.mute")
            }
            aria-pressed={muted}
          >
            {muted ? <MicOffIcon size={17} /> : <MicIcon size={17} />}
          </button>
          <button
            className={deafened ? "iconbtn iconbtn--danger" : "iconbtn"}
            onClick={() => void toggleDeafen()}
            disabled={own?.deaf && !own.selfDeaf}
            title={
              own?.deaf && !own.selfDeaf
                ? t("voice.deafenedByServer")
                : deafened
                  ? t("voice.undeafen")
                  : t("voice.deafen")
            }
            aria-pressed={deafened}
          >
            {deafened ? (
              <HeadphonesOffIcon size={17} />
            ) : (
              <HeadphonesIcon size={17} />
            )}
          </button>
          <button
            className="iconbtn"
            onClick={onOpenVoiceSettings}
            title={t("voice.settings")}
            aria-label={t("voice.settings")}
          >
            <GearIcon size={17} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
