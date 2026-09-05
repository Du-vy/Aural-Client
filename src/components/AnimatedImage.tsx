import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { useWindowFocused } from "@/lib/windowFocus";
import { usePauseAnimatedOnBlur } from "@/lib/storage";

export interface AnimatedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /**
   * Explicitly flags whether this image is animated (GIF, APNG, animated WebP).
   * If not provided, it is auto-detected from the URL extension / parameters.
   */
  animated?: boolean;
  /**
   * Whether hovering over a frozen image temporarily unpauses it to preview.
   * Defaults to true.
   */
  interactive?: boolean;
  /**
   * Override for the pause-on-blur behavior.
   * If omitted, reads the user's Accessibility setting.
   */
  pauseOnBlur?: boolean;
  /**
   * Optional external hover state (e.g. when parent component manages hover).
   */
  hovered?: boolean;
}

/**
 * Checks if an image URL is likely an animated format (GIF, WebP, APNG,
 * or from known animated GIF providers like Tenor, Giphy, Klipy).
 */
export function isPotentiallyAnimated(url?: string | null): boolean {
  if (!url) return false;
  try {
    const clean = url.split("?")[0]!.split("#")[0]!.toLowerCase();
    if (clean.endsWith(".gif") || clean.endsWith(".apng") || clean.endsWith(".webp")) {
      return true;
    }
    const lower = url.toLowerCase();
    return (
      lower.includes("format=gif") ||
      lower.includes("mime=image/gif") ||
      lower.includes("/gifs/") ||
      lower.includes("/stickers/") ||
      lower.includes("tenor.com") ||
      lower.includes("giphy.com") ||
      lower.includes("klipy.com") ||
      (lower.includes("discord") && lower.includes("/a_"))
    );
  } catch {
    return false;
  }
}

/**
 * AnimatedImage replaces or augments <img> for animated media (GIFs, APNGs, WebPs).
 *
 * When the window/app loses focus and the "Pause animated media in background" setting is on:
 * - It captures the current frame into an identical <canvas> element.
 * - Hides the native <img> (display: none), completely halting Chromium/WebKit's
 *   animated frame decoding, timer loops, and GPU compositing.
 * - If interactive (default true), hovering with the mouse temporarily activates the <img>
 *   to preview the animation, matching Discord's behavior.
 * - When the window regains focus, the <img> is restored seamlessly.
 */
export const AnimatedImage = forwardRef<HTMLImageElement, AnimatedImageProps>(function AnimatedImage(
  {
    src,
    alt,
    className,
    style,
    animated,
    interactive = true,
    pauseOnBlur,
    hovered,
    onLoad,
    onMouseEnter,
    onMouseLeave,
    onClick,
    onContextMenu,
    title,
    ...rest
  },
  forwardedRef,
) {
  const isWindowFocused = useWindowFocused();
  const settingPauseOnBlur = usePauseAnimatedOnBlur();
  const [internalHovered, setInternalHovered] = useState(false);
  const isHovered = hovered !== undefined ? hovered : internalHovered;

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(forwardedRef, () => imgRef.current as HTMLImageElement);

  const isAnimated = animated !== undefined ? animated : isPotentiallyAnimated(src);
  const effectivePauseOnBlur = pauseOnBlur !== undefined ? pauseOnBlur : settingPauseOnBlur;
  const shouldFreeze = isAnimated && effectivePauseOnBlur && !isWindowFocused && (!interactive || !isHovered);

  const captureFrame = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        try {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch {
          // If drawing fails (e.g. cross-origin restrictions), image continues to render naturally
        }
      }
    }
  };

  // Capture frame whenever we transition into the frozen state
  useEffect(() => {
    if (shouldFreeze) {
      captureFrame();
    }
  }, [shouldFreeze, src]);

  // Non-animated images don't need any canvas handling
  if (!isAnimated) {
    return (
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        style={style}
        onLoad={onLoad}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        {...rest}
      />
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          ...style,
          display: shouldFreeze ? style?.display : "none",
        }}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLCanvasElement>}
        onContextMenu={onContextMenu as unknown as React.MouseEventHandler<HTMLCanvasElement>}
        onMouseEnter={() => interactive && setInternalHovered(true)}
        onMouseLeave={() => interactive && setInternalHovered(false)}
        title={title}
        aria-hidden={rest["aria-hidden"]}
      />
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        style={{
          ...style,
          display: shouldFreeze ? "none" : style?.display,
        }}
        onLoad={(e: SyntheticEvent<HTMLImageElement, Event>) => {
          onLoad?.(e);
          if (shouldFreeze) {
            captureFrame();
          }
        }}
        onMouseEnter={(e) => {
          onMouseEnter?.(e);
          if (interactive) setInternalHovered(true);
        }}
        onMouseLeave={(e) => {
          onMouseLeave?.(e);
          if (interactive) setInternalHovered(false);
        }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={title}
        {...rest}
      />
    </>
  );
});
