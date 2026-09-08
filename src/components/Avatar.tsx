import { useState, useEffect } from "react";
import type { User, UserStatus, CustomAvatarFrame } from "@/lib/protocol";
import { useSession } from "@/store/session";
import {
  readProfileCosmetics,
  onProfileCosmeticsChanged,
  resolveAvatarFrameConfig,
  type AvatarFrameId,
  type FrameStyleId,
  type FrameAnimationId,
  type ProfileCosmetics,
} from "@/lib/storage";
import { AnimatedImage } from "./AnimatedImage";

const PALETTE = [
  "#12b8a0",
  "#5b8cff",
  "#c471ed",
  "#e0a030",
  "#e5534b",
  "#3ba55d",
  "#f2779a",
  "#4ec5d4",
];

export function avatarColor(id: number): string {
  return PALETTE[Math.abs(id) % PALETTE.length]!;
}

/** Up to two initials taken from the nickname, falling back to a bullet. */
export function initials(nickname: string): string {
  const words = nickname.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return [...words[0]!].slice(0, 2).join("").toUpperCase();
  return (`${[...words[0]!][0] ?? ""}${[...words[words.length - 1]!][0] ?? ""}`).toUpperCase();
}

export function resolveAvatarUrl(
  url: string | null | undefined,
  address?: import("@/lib/address").ServerAddress | string | null,
): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  if (url.startsWith("/")) {
    if (!address) return url;
    if (typeof address === "string") {
      return `${address}${url}`;
    }
    const scheme = address.secure ? "https" : "http";
    const host = address.host.includes(":") && !address.host.startsWith("[")
      ? `[${address.host}]`
      : address.host;
    return `${scheme}://${host}:${address.port}${url}`;
  }
  return url;
}

interface AvatarProps {
  user: Pick<User, "id" | "nickname"> & {
    avatar?: string | null;
    status?: UserStatus | string;
    themeColor?: string;
    customFrame?: CustomAvatarFrame;
  };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Explicit online boolean or status */
  online?: boolean;
  status?: UserStatus | string;
  showStatus?: boolean;
  className?: string;
  /** Explicit frame or fallback to user's saved cosmetics */
  frame?: AvatarFrameId | FrameStyleId;
  frameAnimation?: FrameAnimationId;
  frameColor?: string;
  frameColor2?: string;
  style?: React.CSSProperties;
}

export function Avatar({
  user,
  size = "sm",
  online,
  status,
  showStatus,
  className = "",
  frame,
  frameAnimation,
  frameColor,
  frameColor2,
  style,
}: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const address = useSession((state) => state.address);
  const self = useSession((state) => state.self);
  const color = avatarColor(user.id);
  const isSelf = Boolean(self && user.id === self.id);

  const [selfCosmetics, setSelfCosmetics] = useState<ProfileCosmetics>(readProfileCosmetics);

  useEffect(() => {
    if (!isSelf) return;
    return onProfileCosmeticsChanged(setSelfCosmetics);
  }, [isSelf]);

  useEffect(() => {
    setImgError(false);
  }, [user.avatar]);

  const avatarSrc = !imgError ? resolveAvatarUrl(user.avatar, address) : null;

  // Determine effective presence status
  const effectiveStatus: UserStatus | null = status
    ? (status as UserStatus)
    : user.status
      ? (user.status as UserStatus)
      : online !== undefined
        ? (online ? "online" : "offline")
        : null;

  const shouldShowBadge = showStatus || (online !== undefined && online) || status !== undefined || (effectiveStatus && effectiveStatus !== "offline");

  const userThemeColor = user.themeColor || (isSelf ? selfCosmetics.themeColor : undefined);
  const userCustomFrame = user.customFrame || (isSelf ? selfCosmetics.customFrame : undefined);

  const effectiveCosmetics: ProfileCosmetics = {
    themeColor: userThemeColor,
    customFrame: userCustomFrame,
  };
  const resolvedFrame = resolveAvatarFrameConfig(effectiveCosmetics);

  const effectiveStyle: FrameStyleId | AvatarFrameId = frame !== undefined
    ? frame
    : (resolvedFrame ? resolvedFrame.style : "none");

  const effectiveAnim: FrameAnimationId = frameAnimation !== undefined
    ? frameAnimation
    : (resolvedFrame ? resolvedFrame.animation : "none");

  const hasFrame = effectiveStyle !== "none";

  const targetAccent = (style && ("--user-profile-accent" in style))
    ? ((style as Record<string, unknown>)["--user-profile-accent"] as string)
    : userThemeColor;

  const effectiveFrameColor = frameColor
    || (resolvedFrame ? resolvedFrame.color : undefined)
    || targetAccent
    || "#12b8a0";

  const isSpinning = effectiveAnim === "spin";
  const defaultColor2 = isSpinning
    ? `${effectiveFrameColor}2e`
    : effectiveFrameColor;

  const effectiveFrameColor2 = frameColor2
    || (resolvedFrame ? resolvedFrame.color2 : undefined)
    || defaultColor2;

  const combinedStyle: React.CSSProperties = {
    ...(!avatarSrc ? { background: `${color}2e`, color } : {}),
    ...(targetAccent
      ? ({
          "--user-profile-accent": targetAccent,
          "--user-profile-accent-glow": `${targetAccent}66`,
        } as React.CSSProperties)
      : {}),
    ...(hasFrame && effectiveFrameColor
      ? ({
          "--avatar-frame-color": effectiveFrameColor,
          "--avatar-frame-color-2": effectiveFrameColor2,
          "--avatar-frame-glow": `${effectiveFrameColor}66`,
          "--avatar-frame-glow-2": `${effectiveFrameColor2}66`,
        } as React.CSSProperties)
      : {}),
    ...style,
  };

  return (
    <span
      className={`avatar avatar--${size} ${hasFrame ? "avatar--has-frame" : ""} ${className}`}
      style={combinedStyle}
      aria-hidden="true"
    >
      {hasFrame && (
        <span
          className={`avatar__frame-layer avatar--frame-${effectiveStyle} ${effectiveAnim !== "none" ? `avatar--anim-${effectiveAnim}` : ""}`}
          aria-hidden="true"
        />
      )}
      {avatarSrc ? (
        <AnimatedImage
          src={avatarSrc}
          alt={user.nickname}
          className="avatar__img"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <span className="avatar__initials">{initials(user.nickname)}</span>
      )}

      {shouldShowBadge && effectiveStatus ? (
        <span className={`avatar__badge avatar__badge--${effectiveStatus}`} title={effectiveStatus}>
          {effectiveStatus === "dnd" ? (
            <svg viewBox="0 0 10 10" className="avatar__badge-icon">
              <circle cx="5" cy="5" r="5" fill="#f23f43" />
              <rect x="2" y="4" width="6" height="2" rx="0.75" fill="#ffffff" />
            </svg>
          ) : effectiveStatus === "idle" ? (
            <svg viewBox="0 0 10 10" className="avatar__badge-icon">
              <circle cx="5" cy="5" r="5" fill="#f0b232" />
              <path d="M6.8 1.5A4 4 0 1 0 8.5 7.2 4.5 4.5 0 0 1 6.8 1.5z" fill="#1e1f22" opacity="0.9" />
            </svg>
          ) : effectiveStatus === "invisible" || effectiveStatus === "offline" ? (
            <svg viewBox="0 0 10 10" className="avatar__badge-icon">
              <circle cx="5" cy="5" r="3.75" fill="none" stroke="#80848e" strokeWidth="2.2" />
            </svg>
          ) : (
            <span className="avatar__dot" />
          )}
        </span>
      ) : null}
    </span>
  );
}
