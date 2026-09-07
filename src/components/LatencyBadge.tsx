/**
 * The round-trip readout: three bars and a number.
 *
 * It is drawn in two places that mean two different distances — the sidebar
 * header, where it is the delay to the server, and the voice panel, where it
 * is the delay on the call — so what it is measuring is never left to be
 * guessed at from position alone; the tooltip says which.
 *
 * The bars are what makes it readable without being read. A number alone asks
 * somebody to remember whether ninety is good, and most people looking at this
 * are not asking for a figure, they are asking whether the connection is the
 * reason something feels wrong.
 */

import { useTranslation } from "@/lib/i18n";

/**
 * Where the bars change.
 *
 * Voice is judged harder than the gateway on purpose. A hundred milliseconds
 * on a text connection is invisible — nothing waits on it but a read marker —
 * while the same delay on a call is the pause that makes two people talk over
 * each other.
 */
const THRESHOLDS = {
  server: { good: 100, fair: 250 },
  voice: { good: 60, fair: 150 },
} as const;

export type LatencyKind = keyof typeof THRESHOLDS;

interface LatencyBadgeProps {
  /** The round trip in milliseconds, or null when there is nothing to show. */
  latencyMs: number | null;
  kind: LatencyKind;
  /** Hides the figure, leaving the bars. For places with no room for both. */
  compact?: boolean;
}

function quality(latencyMs: number, kind: LatencyKind): "good" | "fair" | "poor" {
  const { good, fair } = THRESHOLDS[kind];
  if (latencyMs <= good) return "good";
  if (latencyMs <= fair) return "fair";
  return "poor";
}

export function LatencyBadge({ latencyMs, kind, compact = false }: LatencyBadgeProps) {
  const { t } = useTranslation();

  // Nothing measured is not the same as a bad connection, and drawing empty
  // bars for it would say the second thing. An old server that has never heard
  // of the ping op lands here for the whole session.
  if (latencyMs === null) return null;

  const level = quality(latencyMs, kind);
  const bars = level === "good" ? 3 : level === "fair" ? 2 : 1;
  const label = t("latency.value", { ms: latencyMs });
  const what = t(kind === "voice" ? "latency.voice" : "latency.server");

  return (
    <span className={`latency latency--${level}`} title={`${what} — ${label}`} aria-label={`${what} — ${label}`}>
      <span className="latency__bars" aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <i key={bar} className={bar <= bars ? "latency__bar latency__bar--on" : "latency__bar"} />
        ))}
      </span>
      {compact ? null : (
        <span className="latency__value" aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
