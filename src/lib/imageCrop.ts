import * as omggifPkg from "omggif";
import * as gifencPkg from "gifenc";

// Interoperable imports for both browser bundler (Vite) and Node.js runtime (render-check)
const GifReader = (omggifPkg as any).GifReader ?? (omggifPkg as any).default?.GifReader;
const { GIFEncoder, quantize, applyPalette } = ((gifencPkg as any).default ?? gifencPkg) as typeof gifencPkg;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOptions {
  file: File;
  crop: CropRect;
  outputWidth: number;
  outputHeight: number;
  onProgress?: (fraction: number) => void;
}

/**
 * Checks if a file is an animated GIF by inspecting its GIF blocks.
 */
export async function isAnimatedGif(file: File): Promise<boolean> {
  const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
  if (!isGif) return false;

  try {
    const buffer = await file.slice(0, 500 * 1024).arrayBuffer();
    const reader = new GifReader(new Uint8Array(buffer));
    return reader.numFrames() > 1;
  } catch {
    return false;
  }
}

/**
 * Crops a static image using HTML5 Canvas.
 */
async function cropStaticImage({
  file,
  crop,
  outputWidth,
  outputHeight,
}: CropOptions): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const scale = outputWidth / crop.width;
        const destX = -crop.x * scale;
        const destY = -crop.y * scale;
        const destW = img.naturalWidth * scale;
        const destH = img.naturalHeight * scale;

        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, destX, destY, destW, destH);

        const isPng = file.type === "image/png";
        const outputType = isPng ? "image/png" : "image/webp";
        const outputExt = isPng ? "png" : "webp";

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const croppedFile = new File(
              [blob],
              `${file.name.replace(/\.[^/.]+$/, "")}.${outputExt}`,
              { type: outputType, lastModified: Date.now() },
            );
            resolve(croppedFile);
          },
          outputType,
          0.92,
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

/**
 * Crops an animated GIF frame by frame, preserving timing, palette and animation loops.
 */
async function cropAnimatedGif({
  file,
  crop,
  outputWidth,
  outputHeight,
  onProgress,
}: CropOptions): Promise<File> {
  const buffer = await file.arrayBuffer();
  const reader = new GifReader(new Uint8Array(buffer));
  const numFrames = reader.numFrames();

  if (numFrames <= 1) {
    return cropStaticImage({ file, crop, outputWidth, outputHeight });
  }

  const { width: natW, height: natH } = reader;

  // Source canvas to blit composited frame pixels
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = natW;
  srcCanvas.height = natH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

  // Destination canvas for the cropped & scaled window
  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = outputWidth;
  targetCanvas.height = outputHeight;
  const targetCtx = targetCanvas.getContext("2d", { willReadFrequently: true });

  if (!srcCtx || !targetCtx) {
    return cropStaticImage({ file, crop, outputWidth, outputHeight });
  }

  const encoder = new GIFEncoder();
  const scale = outputWidth / crop.width;
  const destX = -crop.x * scale;
  const destY = -crop.y * scale;
  const destW = natW * scale;
  const destH = natH * scale;

  const framePixels = new Uint8Array(natW * natH * 4);
  let prevPixels: Uint8Array | null = null;
  let prevDisposal = 0;
  let prevFrame: { x: number; y: number; width: number; height: number } | null = null;

  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);

    // Handle GIF disposal from previous frame
    if (prevDisposal === 3 && prevPixels) {
      framePixels.set(prevPixels);
    } else if (prevDisposal === 2 && prevFrame) {
      for (let r = 0; r < prevFrame.height; r++) {
        const start = ((prevFrame.y + r) * natW + prevFrame.x) * 4;
        framePixels.fill(0, start, start + prevFrame.width * 4);
      }
    }

    if (info.disposal === 3) {
      prevPixels = new Uint8Array(framePixels);
    }
    prevDisposal = info.disposal;
    prevFrame = info;

    // Decode current frame RGBA onto accumulated buffer
    reader.decodeAndBlitFrameRGBA(i, framePixels);

    const imgData = new ImageData(new Uint8ClampedArray(framePixels.buffer), natW, natH);
    srcCtx.putImageData(imgData, 0, 0);

    targetCtx.clearRect(0, 0, outputWidth, outputHeight);
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = "high";
    targetCtx.drawImage(srcCanvas, 0, 0, natW, natH, destX, destY, destW, destH);

    const targetData = targetCtx.getImageData(0, 0, outputWidth, outputHeight).data;

    // Detect if frame has any transparent pixels
    let hasTransparency = false;
    for (let p = 3; p < targetData.length; p += 4) {
      if (targetData[p]! < 128) {
        hasTransparency = true;
        break;
      }
    }

    let palette: number[][];
    let index: Uint8Array;
    let transparentIndex = -1;

    if (hasTransparency) {
      palette = quantize(targetData, 256, { format: "rgba4444", oneBitAlpha: true });
      index = applyPalette(targetData, palette, "rgba4444");
      transparentIndex = palette.findIndex((c) => c[3] === 0);
    } else {
      palette = quantize(targetData, 256, { format: "rgb565" });
      index = applyPalette(targetData, palette, "rgb565");
    }

    // Delay in milliseconds (GIF stores in 1/100s, default 10 = 100ms)
    const delay = Math.max(20, (info.delay || 10) * 10);

    encoder.writeFrame(index, outputWidth, outputHeight, {
      palette,
      delay,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
      repeat: 0,
    });

    onProgress?.((i + 1) / numFrames);

    // Yield control periodically to keep browser UI responsive
    if (i % 2 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  encoder.finish();
  const bytes = encoder.bytes();

  return new File([bytes as unknown as BlobPart], `${file.name.replace(/\.[^/.]+$/, "")}.gif`, {
    type: "image/gif",
    lastModified: Date.now(),
  });
}

/**
 * Main crop entrypoint: crops both static images and animated GIFs preserving animation.
 */
export async function cropImage(options: CropOptions): Promise<File> {
  const isGif = options.file.type === "image/gif" || options.file.name.toLowerCase().endsWith(".gif");

  if (isGif) {
    try {
      return await cropAnimatedGif(options);
    } catch (err) {
      console.warn("Failed to crop animated GIF, falling back to static crop", err);
      return await cropStaticImage(options);
    }
  }

  return cropStaticImage(options);
}
