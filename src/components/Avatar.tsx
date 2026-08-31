import type { User } from "@/lib/protocol";

/**
 * Identity is not a picture in v0.1, so a member reads as their initials over a
 * colour derived from their id. The same person is therefore the same colour on
 * every client, with no avatar upload or storage anywhere.
 */

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

interface AvatarProps {
  user: Pick<User, "id" | "nickname">;
  size?: "sm" | "md";
  /** Draws the presence dot. */
  online?: boolean;
}

export function Avatar({ user, size = "sm", online = false }: AvatarProps) {
  const color = avatarColor(user.id);
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ background: `${color}2e`, color }}
      aria-hidden="true"
    >
      {initials(user.nickname)}
      {online ? <span className="avatar__dot" /> : null}
    </span>
  );
}
