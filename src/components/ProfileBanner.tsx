import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { AnimatedImage } from "./AnimatedImage";

export interface ProfileBannerProps extends HTMLAttributes<HTMLDivElement> {
  /** Resolved banner URL, or null/undefined when the member has none. */
  src?: string | null;
  /** Painted instead of the image when there is no banner — usually a gradient. */
  fallbackStyle?: CSSProperties;
  children?: ReactNode;
}

/**
 * The image strip across the top of a profile card.
 *
 * The banner is drawn as a real <img> rather than a CSS background so that an
 * animated one (GIF, APNG, animated WebP) goes through AnimatedImage and obeys
 * the "pause animated media in background" setting like every other animation
 * in the client. A CSS background cannot be frozen: the compositor keeps
 * decoding its frames no matter what the window is doing.
 *
 * Hover is tracked on the box rather than left to the image, because the close
 * button and the edit overlay sit on top of it — hovering those is still
 * hovering the banner, and the animation should not stutter as the pointer
 * crosses them.
 */
export function ProfileBanner({
  src,
  fallbackStyle,
  className,
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ProfileBannerProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={className}
      style={src ? style : { ...fallbackStyle, ...style }}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        setHovered(true);
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        setHovered(false);
      }}
      {...rest}
    >
      {src ? (
        <AnimatedImage
          src={src}
          alt=""
          className="profile-banner__media"
          hovered={hovered}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </div>
  );
}
