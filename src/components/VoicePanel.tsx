import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { canOpenPrivacySettings, openPrivacySettings } from "@/lib/open";
import { readAccessibility } from "@/lib/storage";
import { playMuteCue } from "@/lib/audioCues";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { SoundboardPanel } from "./SoundboardPanel";
import { useCall, useServerRegistry, useServers } from "@/store/servers";
import { useVoice } from "@/store/voice";
import {
  BroadcastIcon,
  GearIcon,
  HangUpIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  SoundboardIcon,
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
 *
 * It reads the connection carrying the call rather than the one on screen,
 * because a call outlives looking at the server it is on: leaving it, muting
 * on it and seeing who is relaying it all have to work from anywhere.
 */
export function VoicePanel({ onOpenVoiceSettings }: VoicePanelProps) {
  const { t } = useTranslation();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const self = useCall((state) => state.self);
  const channels = useCall((state) => state.channels);
  const users = useCall((state) => state.users);
  const voiceStates = useCall((state) => state.voiceStates);
  const leaveChannel = useCall((state) => state.leaveChannel);
  const callServerId = useCall((state) => state.serverId);
  const callServerName = useCall((state) => state.server?.name ?? "");
  const foregroundId = useServerRegistry((state) => state.foregroundId);

  const sounds = useCall((state) => state.sounds);

  const status = useVoice((state) => state.status);
  const notice = useVoice((state) => state.notice);
  const micError = useVoice((state) => state.micError);
  const carriesAudio = useVoice((state) => state.config?.enabled ?? false);
  const mode = useVoice((state) => state.mode);
  const hostUserId = useVoice((state) => state.hostUserId);
  const toggleMute = useVoice((state) => state.toggleMute);
  const toggleDeafen = useVoice((state) => state.toggleDeafen);
  const retryMicrophone = useVoice((state) => state.retryMicrophone);

  // The channel comes from presence rather than from the voice store, so this
  // strip appears the moment somebody is in a voice channel — including on a
  // server that carries no audio, where sitting in one is all there is.
  const channelId = self?.channelId ?? null;
  const channel = channelId === null ? null : channels.get(channelId);
  if (!self || !channel || channel.type !== "voice") return null;

  const elsewhere = callServerId !== "" && callServerId !== foregroundId;
  const own = voiceStates.get(self.id);
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
          {elsewhere ? (
            <button
              type="button"
              className="voicepanel__server"
              onClick={() => useServers.getState().focus(callServerId)}
              title={t("voice.callOnServerGo", { server: callServerName })}
            >
              {t("voice.callOnServer", { server: callServerName })}
            </button>
          ) : null}
        </span>
        <button
          className="iconbtn iconbtn--danger"
          onClick={() => {
            if (readAccessibility().confirmVoiceDisconnect) {
              setConfirmLeave(true);
            } else {
              void leaveChannel();
            }
          }}
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
            onClick={() => {
              playMuteCue(!muted);
              void toggleMute();
            }}
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
          {/* A server with no clips has nothing to open, and a button that
              opens an empty panel is worse than no button. */}
          {sounds.size > 0 ? (
            <button
              className={soundboardOpen ? "iconbtn iconbtn--active" : "iconbtn"}
              onClick={() => setSoundboardOpen((open) => !open)}
              title={t("soundboard.title")}
              aria-label={t("soundboard.title")}
              aria-expanded={soundboardOpen}
            >
              <SoundboardIcon size={17} />
            </button>
          ) : null}
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

      {soundboardOpen ? <SoundboardPanel onClose={() => setSoundboardOpen(false)} /> : null}

      {confirmLeave ? (
        <ConfirmDialog
          title={t("voice.confirmDisconnectTitle")}
          subtitle={t("voice.confirmDisconnectDesc")}
          confirmText={t("voice.disconnect")}
          danger
          onConfirm={() => void leaveChannel()}
          onClose={() => setConfirmLeave(false)}
        />
      ) : null}
    </div>
  );
}
