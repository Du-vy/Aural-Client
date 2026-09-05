import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatBytes } from "@/lib/uploads";
import { useSession } from "@/store/session";
import type { ServerMetricsResponse } from "@/lib/protocol";
import {
  CpuIcon,
  DatabaseIcon,
  HardDriveIcon,
  ActivityIcon,
  RefreshCwIcon,
  FilmIcon,
  MediaIcon,
  VoiceIcon,
  FileTextIcon,
  SmileyIcon,
  StickerIcon,
  SoundboardIcon,
  UsersIcon,
  ClockIcon,
} from "@/components/Icons";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ${m % 60}m`;
}

export function ServerTelemetrySection() {
  const { t } = useTranslation();
  const fetchServerMetrics = useSession((state) => state.fetchServerMetrics);

  const [metrics, setMetrics] = useState<ServerMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  const load = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      try {
        const data = await fetchServerMetrics(force);
        setMetrics(data);
        setError(null);
        setLastFetched(new Date());
        setSecondsAgo(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchServerMetrics],
  );

  // Initial load
  useEffect(() => {
    void load(false);
  }, [load]);

  // Auto-refresh interval (5s)
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void load(false);
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  // Elapsed seconds timer
  useEffect(() => {
    if (!lastFetched) return;
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastFetched.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastFetched]);

  if (loading && !metrics) {
    return (
      <div className="settings-card server-telemetry-loading">
        <div className="telemetry-spinner" />
        <p className="settings-card__subtitle">{t("dialogs.serverSettings.overview.loadingMetrics")}</p>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="settings-card">
        <div className="alert alert--danger">{t("dialogs.serverSettings.overview.metricsError")}: {error}</div>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          style={{ marginTop: 8 }}
          onClick={() => void load(true)}
        >
          {t("dialogs.serverSettings.overview.refresh")}
        </button>
      </div>
    );
  }

  if (!metrics) return null;

  // Calculate storage segments for the multi-colored bar
  const totalStorage = Math.max(metrics.storage.totalBytes, 1);
  const videoBytes = metrics.storage.attachments.videos.bytes;
  const imageBytes = metrics.storage.attachments.images.bytes;
  const audioBytes = metrics.storage.attachments.audio.bytes;
  const fileBytes = metrics.storage.attachments.files.bytes;
  const profileBytes = metrics.storage.profiles.total.bytes;
  const exprBytes = metrics.storage.expressions.total.bytes;
  const dbBytes = metrics.storage.database.sizeBytes;

  const videoPct = (videoBytes / totalStorage) * 100;
  const imagePct = (imageBytes / totalStorage) * 100;
  const audioPct = (audioBytes / totalStorage) * 100;
  const filePct = (fileBytes / totalStorage) * 100;
  const profilePct = (profileBytes / totalStorage) * 100;
  const exprPct = (exprBytes / totalStorage) * 100;
  const dbPct = (dbBytes / totalStorage) * 100;

  // CPU bar color class
  const cpuPercent = metrics.cpu.processPercent;
  const cpuColor = cpuPercent > 85 ? "danger" : cpuPercent > 60 ? "warning" : "normal";

  // RAM bar color class
  const ramPercent = metrics.memory.systemPercent;
  const ramColor = ramPercent > 90 ? "danger" : ramPercent > 75 ? "warning" : "normal";

  return (
    <div className="server-telemetry-container">
      {/* Header with Title and Live Controls */}
      <div className="server-telemetry-header">
        <div className="server-telemetry-title-group">
          <div className="server-telemetry-badge">
            <span className="telemetry-live-dot" />
            <span>LIVE</span>
          </div>
          <div>
            <h3 className="settings-card__title">
              {t("dialogs.serverSettings.overview.serverStatusTitle")}
            </h3>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.overview.serverStatusDesc")}
            </p>
          </div>
        </div>

        <div className="server-telemetry-controls">
          <label className="telemetry-switch-label" title={t("dialogs.serverSettings.overview.autoRefreshHint")}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="telemetry-switch-checkbox"
            />
            <span className="telemetry-switch-text">
              {t("dialogs.serverSettings.overview.autoRefresh")}
            </span>
          </label>

          <button
            type="button"
            className="btn btn--secondary btn--sm telemetry-refresh-btn"
            onClick={() => void load(true)}
            disabled={refreshing}
            title={t("dialogs.serverSettings.overview.refresh")}
          >
            <span className={refreshing ? "telemetry-spin" : ""}>
              <RefreshCwIcon size={14} />
            </span>
            <span>{t("dialogs.serverSettings.overview.refresh")}</span>
          </button>
        </div>
      </div>

      {lastFetched ? (
        <div className="telemetry-updated-indicator">
          {secondsAgo <= 1
            ? t("dialogs.serverSettings.overview.justNow")
            : t("dialogs.serverSettings.overview.lastUpdated", { seconds: secondsAgo })}
        </div>
      ) : null}

      {/* Vitals Cards Grid: CPU, RAM, Disk, Uptime */}
      <div className="telemetry-vitals-grid">
        {/* CPU Card */}
        <div className="telemetry-vital-card">
          <div className="telemetry-vital-card__head">
            <span className="telemetry-vital-icon telemetry-vital-icon--cpu">
              <CpuIcon size={18} />
            </span>
            <span className="telemetry-vital-title">{t("dialogs.serverSettings.overview.cpu")}</span>
          </div>
          <div className="telemetry-vital-value">
            {metrics.cpu.processPercent.toFixed(1)}%
            <span className="telemetry-vital-unit">{t("dialogs.serverSettings.overview.cpuProcess")}</span>
          </div>
          <div className="telemetry-meter-track">
            <div
              className={`telemetry-meter-fill telemetry-meter-fill--${cpuColor}`}
              style={{ width: `${Math.min(Math.max(metrics.cpu.processPercent, 2), 100)}%` }}
            />
          </div>
          <div className="telemetry-vital-foot">
            <span>
              {t("dialogs.serverSettings.overview.cpuHost")}: {metrics.cpu.systemPercent.toFixed(1)}%
            </span>
            <span>{t("dialogs.serverSettings.overview.cpuCores", { count: metrics.cpu.cores })}</span>
          </div>
        </div>

        {/* RAM Card */}
        <div className="telemetry-vital-card">
          <div className="telemetry-vital-card__head">
            <span className="telemetry-vital-icon telemetry-vital-icon--ram">
              <ActivityIcon size={18} />
            </span>
            <span className="telemetry-vital-title">{t("dialogs.serverSettings.overview.ram")}</span>
          </div>
          <div className="telemetry-vital-value">
            {formatBytes(metrics.memory.processRss)}
            <span className="telemetry-vital-unit">{t("dialogs.serverSettings.overview.ramProcess")}</span>
          </div>
          <div className="telemetry-meter-track">
            <div
              className={`telemetry-meter-fill telemetry-meter-fill--${ramColor}`}
              style={{ width: `${Math.min(Math.max(metrics.memory.systemPercent, 2), 100)}%` }}
            />
          </div>
          <div className="telemetry-vital-foot">
            <span>
              {t("dialogs.serverSettings.overview.ramHost")}: {formatBytes(metrics.memory.systemUsed)} / {formatBytes(metrics.memory.systemTotal)}
            </span>
            <span>{metrics.memory.systemPercent.toFixed(0)}%</span>
          </div>
        </div>

        {/* Storage Summary Card */}
        <div className="telemetry-vital-card">
          <div className="telemetry-vital-card__head">
            <span className="telemetry-vital-icon telemetry-vital-icon--storage">
              <HardDriveIcon size={18} />
            </span>
            <span className="telemetry-vital-title">{t("dialogs.serverSettings.overview.storage")}</span>
          </div>
          <div className="telemetry-vital-value">
            {formatBytes(metrics.storage.totalBytes)}
            <span className="telemetry-vital-unit">{t("dialogs.serverSettings.overview.storageTotalAural")}</span>
          </div>
          <div className="telemetry-meter-track">
            <div
              className="telemetry-meter-fill telemetry-meter-fill--storage"
              style={{
                width: `${metrics.storage.hostTotal > 0 ? Math.min(Math.max(((metrics.storage.hostTotal - metrics.storage.hostFree) / metrics.storage.hostTotal) * 100, 2), 100) : 10}%`,
              }}
            />
          </div>
          <div className="telemetry-vital-foot">
            <span>{t("dialogs.serverSettings.overview.storageHostFree", { free: formatBytes(metrics.storage.hostFree) })}</span>
            {metrics.storage.hostTotal > 0 ? <span>Total: {formatBytes(metrics.storage.hostTotal)}</span> : null}
          </div>
        </div>

        {/* Uptime Card */}
        <div className="telemetry-vital-card">
          <div className="telemetry-vital-card__head">
            <span className="telemetry-vital-icon telemetry-vital-icon--uptime">
              <ClockIcon size={18} />
            </span>
            <span className="telemetry-vital-title">{t("dialogs.serverSettings.overview.uptime")}</span>
          </div>
          <div className="telemetry-vital-value">
            {formatUptime(metrics.system.uptimeSeconds)}
          </div>
          <div className="telemetry-uptime-bar" />
          <div className="telemetry-vital-foot">
            <span>
              {metrics.activity.onlineUsers} {t("dialogs.serverSettings.overview.onlineUsers")}
            </span>
            <span>
              {metrics.activity.voiceUsers} {t("dialogs.serverSettings.overview.voiceUsers")}
            </span>
          </div>
        </div>
      </div>

      {/* Storage Breakdown Section */}
      <div className="settings-card telemetry-storage-card">
        <div className="telemetry-storage-head">
          <div>
            <h4 className="settings-card__title">
              {t("dialogs.serverSettings.overview.storageBreakdownTitle")}
            </h4>
            <p className="settings-card__subtitle">
              {t("dialogs.serverSettings.overview.storageBreakdownDesc")}
            </p>
          </div>
          <span className="telemetry-storage-total-pill">
            {formatBytes(metrics.storage.totalBytes)}
          </span>
        </div>

        {/* Continuous Segmented Storage Bar */}
        <div className="telemetry-segmented-bar" role="progressbar" aria-label="Storage breakdown">
          {videoPct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--video"
              style={{ width: `${Math.max(videoPct, 1.5)}%` }}
              title={`Videos: ${formatBytes(videoBytes)} (${videoPct.toFixed(1)}%)`}
            />
          ) : null}
          {imagePct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--image"
              style={{ width: `${Math.max(imagePct, 1.5)}%` }}
              title={`Imágenes: ${formatBytes(imageBytes)} (${imagePct.toFixed(1)}%)`}
            />
          ) : null}
          {audioPct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--audio"
              style={{ width: `${Math.max(audioPct, 1.5)}%` }}
              title={`Audios: ${formatBytes(audioBytes)} (${audioPct.toFixed(1)}%)`}
            />
          ) : null}
          {filePct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--file"
              style={{ width: `${Math.max(filePct, 1.5)}%` }}
              title={`Archivos: ${formatBytes(fileBytes)} (${filePct.toFixed(1)}%)`}
            />
          ) : null}
          {profilePct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--profile"
              style={{ width: `${Math.max(profilePct, 1.5)}%` }}
              title={`Perfiles: ${formatBytes(profileBytes)} (${profilePct.toFixed(1)}%)`}
            />
          ) : null}
          {exprPct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--expr"
              style={{ width: `${Math.max(exprPct, 1.5)}%` }}
              title={`Expresiones y Sonidos: ${formatBytes(exprBytes)} (${exprPct.toFixed(1)}%)`}
            />
          ) : null}
          {dbPct > 0 ? (
            <div
              className="telemetry-segment telemetry-segment--db"
              style={{ width: `${Math.max(dbPct, 1.5)}%` }}
              title={`Base de datos: ${formatBytes(dbBytes)} (${dbPct.toFixed(1)}%)`}
            />
          ) : null}
        </div>

        {/* Itemized Grid of Storage Elements */}
        <div className="telemetry-items-grid">
          {/* Videos */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--video" />
              <FilmIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageVideos")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.attachments.videos.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.attachments.videos.bytes)}</span>
            </div>
          </div>

          {/* Images */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--image" />
              <MediaIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageImages")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.attachments.images.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.attachments.images.bytes)}</span>
            </div>
          </div>

          {/* Audio */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--audio" />
              <VoiceIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageAudio")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.attachments.audio.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.attachments.audio.bytes)}</span>
            </div>
          </div>

          {/* Documents & Files */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--file" />
              <FileTextIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageFiles")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.attachments.files.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.attachments.files.bytes)}</span>
            </div>
          </div>

          {/* Avatars */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--profile" />
              <UsersIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageAvatars")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.profiles.avatars.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.profiles.avatars.bytes)}</span>
            </div>
          </div>

          {/* Banners */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--profile" />
              <MediaIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageBanners")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.profiles.banners.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.profiles.banners.bytes)}</span>
            </div>
          </div>

          {/* Emojis & Stickers */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--expr" />
              <SmileyIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageEmojis")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.expressions.emojis.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.expressions.emojis.bytes)}</span>
            </div>
          </div>

          {/* Stickers */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--expr" />
              <StickerIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageStickers")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.expressions.stickers.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.expressions.stickers.bytes)}</span>
            </div>
          </div>

          {/* Soundboard */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--expr" />
              <SoundboardIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageSounds")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">{metrics.storage.expressions.sounds.count} elem.</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.expressions.sounds.bytes)}</span>
            </div>
          </div>

          {/* SQLite Database */}
          <div className="telemetry-item-row">
            <div className="telemetry-item-name">
              <span className="telemetry-dot telemetry-dot--db" />
              <DatabaseIcon size={15} />
              <span>{t("dialogs.serverSettings.overview.storageDatabase")}</span>
            </div>
            <div className="telemetry-item-meta">
              <span className="telemetry-item-count">SQLite</span>
              <span className="telemetry-item-bytes">{formatBytes(metrics.storage.database.sizeBytes)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* System Telemetry Chips Footer */}
      <div className="telemetry-system-chips">
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">SO / Arch:</span>
          <span className="telemetry-chip-value">{metrics.system.os}/{metrics.system.arch}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Runtime:</span>
          <span className="telemetry-chip-value">{metrics.system.goVersion}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Goroutines:</span>
          <span className="telemetry-chip-value">{metrics.system.goroutines}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Sockets WS:</span>
          <span className="telemetry-chip-value">{metrics.activity.activeConnections}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Salas de Voz:</span>
          <span className="telemetry-chip-value">{metrics.activity.activeVoiceRooms}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Mensajes:</span>
          <span className="telemetry-chip-value">{metrics.activity.totalMessages.toLocaleString()}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Cuentas:</span>
          <span className="telemetry-chip-value">{metrics.activity.registeredUsers}</span>
        </div>
        <div className="telemetry-chip">
          <span className="telemetry-chip-label">Aural Server:</span>
          <span className="telemetry-chip-value">v{metrics.system.serverVersion}</span>
        </div>
      </div>
    </div>
  );
}
