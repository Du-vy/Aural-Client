/**
 * Drawing what somebody is doing outside Aural.
 *
 * Two shapes, because there are two places it is read. The member list and the
 * panel at the bottom of the window have one line each and no room to spare,
 * so they get a string. The profile card has room for the artwork and the
 * timer, so it gets a component.
 *
 * Everything here treats the activity as somebody else's content, because it
 * is: the text came off a stranger's media player and the picture off whatever
 * host their game names. So the pictures are referrer-stripped and lazily
 * loaded, a picture that fails to load leaves no gap, and nothing is ever
 * interpreted as markup.
 */

import { useEffect, useState } from "react";

import { t as translate, useTranslation } from "@/lib/i18n";
import type { Activity } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { resolveAvatarUrl } from "./Avatar";
import { GamepadIcon, MusicNoteIcon } from "./Icons";

/**
 * What the activity is, in a word.
 *
 * A type this build does not know is treated as "playing" rather than dropped:
 * the server it is talking to may be newer than it is, and a member who
 * disappears from the list because of a word is a worse outcome than a word
 * that is slightly wrong.
 */
function verb(activity: Activity): string {
  return activity.type === "listening"
    ? translate("activity.listening")
    : translate("activity.playing");
}

/** Joins the parts that are there, and skips the ones that are not. */
function join(parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" — ");
}

/**
 * The one line a list has room for.
 *
 * There is no verb in it. A list gives an activity a single line, and spending
 * the front of it on "Listening to" costs the words somebody actually wants —
 * which is the track, or the game. The verb is carried by the glyph beside it
 * instead, where it takes a fixed sixteen pixels rather than a variable share
 * of the sentence.
 *
 * What leads differs by kind, for the same reason. Somebody listening cares
 * about the song and not about which player is running it, so the track goes
 * first and the application is left to the card; somebody playing cares about
 * the game, which is the application. Either way the part that matters is at
 * the front, where an ellipsis cannot reach it.
 */
export function activityText(activity: Activity): string {
  if (activity.type === "listening") {
    return join([activity.details, activity.state]) || activity.name;
  }
  return join([activity.name, activity.details || activity.state]);
}

/**
 * The whole of it, for the tooltip — where there is no space to save, so
 * nothing is left out and the verb comes back.
 */
export function activityTooltip(activity: Activity): string {
  return `${verb(activity)}: ${join([activity.name, activity.details, activity.state])}`;
}

interface ActivityGlyphProps {
  activity: Activity;
  size?: number;
  className?: string;
}

/**
 * The glyph that stands in for the verb.
 *
 * Named to its meaning rather than hidden, because it is the only thing
 * carrying that meaning once the words are gone: a screen reader that skipped
 * it would read "Numb — Linkin Park" with no indication that anybody is
 * listening to anything.
 */
export function ActivityGlyph({ activity, size = 13, className }: ActivityGlyphProps) {
  const Glyph = activity.type === "listening" ? MusicNoteIcon : GamepadIcon;
  return (
    <span className={className ?? "activity-glyph"} role="img" aria-label={verb(activity)}>
      <Glyph size={size} />
    </span>
  );
}

/** Counts the seconds since a start, or down to an end. */
function useElapsed(activity: Activity): string | null {
  const [, tick] = useState(0);
  const running = Boolean(activity.startedAt);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!activity.startedAt) return null;
  const now = Math.floor(Date.now() / 1000);

  // A track with a known length counts down to the end, which is what a player
  // shows; anything else counts up from when it started, which is what a game
  // session is measured in.
  if (activity.endsAt && activity.endsAt > activity.startedAt) {
    const left = Math.max(0, activity.endsAt - now);
    return clock(left);
  }
  return clock(Math.max(0, now - activity.startedAt));
}

/** Seconds as h:mm:ss, or m:ss under an hour. */
function clock(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface ActivityCardProps {
  activity: Activity;
}

/** The full form, for a profile card. */
export function ActivityCard({ activity }: ActivityCardProps) {
  const { t } = useTranslation();
  const elapsed = useElapsed(activity);
  // Artwork arrives in three forms and one of them is a path on the server
  // this activity came from: a game names its picture by a key only Discord
  // can resolve, so the server resolves it and serves the result. That is the
  // same shape an avatar takes, and it is resolved the same way.
  const address = useSession((state) => state.address);
  // A picture that will not load leaves the card without one rather than with
  // a broken frame in it. Keyed on the source so a new track tries again.
  const [broken, setBroken] = useState("");

  const image = resolveAvatarUrl(activity.image, address);
  const icon = resolveAvatarUrl(activity.icon, address);
  const showImage = Boolean(image) && broken !== activity.image;
  const showIcon = Boolean(icon) && broken !== activity.icon;

  const counter =
    elapsed === null
      ? null
      : activity.endsAt && activity.endsAt > (activity.startedAt ?? 0)
        ? t("activity.left", { time: elapsed })
        : t("activity.elapsed", { time: elapsed });

  return (
    <div className="activity-card">
      {/* The card is where the glyph and the word appear together, which is
          what makes the glyph on its own legible everywhere else. */}
      <div className="activity-card__label">
        <ActivityGlyph activity={activity} size={12} />
        {verb(activity)}
      </div>

      <div className="activity-card__body">
        {showImage ? (
          <div className="activity-card__art">
            <img
              className="activity-card__image"
              src={image ?? undefined}
              alt={activity.imageText || activity.name}
              title={activity.imageText || undefined}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setBroken(activity.image ?? "")}
            />
            {showIcon ? (
              <img
                className="activity-card__icon"
                src={icon ?? undefined}
                alt={activity.iconText || ""}
                title={activity.iconText || undefined}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setBroken(activity.icon ?? "")}
              />
            ) : null}
          </div>
        ) : null}

        <div className="activity-card__lines">
          <div className="activity-card__name">{activity.name}</div>
          {activity.details ? (
            <div className="activity-card__detail">{activity.details}</div>
          ) : null}
          {activity.state ? <div className="activity-card__detail">{activity.state}</div> : null}
          {activity.party && activity.party.max > 0 ? (
            <div className="activity-card__detail">
              {t("activity.party", {
                size: activity.party.size,
                max: activity.party.max,
              })}
            </div>
          ) : null}
          {counter ? <div className="activity-card__timer">{counter}</div> : null}
        </div>
      </div>
    </div>
  );
}
