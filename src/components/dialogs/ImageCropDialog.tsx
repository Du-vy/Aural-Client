import { useState, useRef, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "../Modal";
import { SparklesIcon, RotateCcwIcon, CheckIcon, UploadIcon } from "../Icons";
import { cropImage } from "@/lib/imageCrop";

interface ImageCropDialogProps {
  file: File;
  type: "avatar" | "banner" | "server-icon";
  onConfirm(file: File): void;
  onClose(): void;
}

export function ImageCropDialog({ file, type, onConfirm, onClose }: ImageCropDialogProps) {
  const { t } = useTranslation();
  const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [cropProgress, setCropProgress] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Load image object URL
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const onImageLoad = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Pointer event handlers for smooth dragging
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = -e.deltaY * 0.0015;
    setZoom((prev) => Math.max(0.2, Math.min(4, Number((prev + delta).toFixed(3)))));
  };

  const finish = (result: File) => {
    setProcessing(false);
    setCropProgress(null);
    onConfirm(result);
  };

  const handleApplyCropped = async () => {
    if (!imgRef.current || !containerRef.current) {
      finish(file);
      return;
    }
    setProcessing(true);
    setCropProgress(0);

    try {
      const img = imgRef.current;
      const overlay = overlayRef.current ?? containerRef.current;
      const overlayRect = overlay.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();

      // Target output dimensions:
      // Avatars / Server Icons: 384x384 for static, 256x256 for GIF (lightweight & crisp)
      // Banners: 960x320 for static, 640x213 for GIF (3:1 aspect ratio)
      const isSquare = type === "avatar" || type === "server-icon";
      const targetWidth = isSquare ? (isGif ? 256 : 384) : isGif ? 640 : 960;
      const targetHeight = isSquare ? (isGif ? 256 : 384) : isGif ? 213 : 320;

      const scaleX = img.naturalWidth / imgRect.width;
      const scaleY = img.naturalHeight / imgRect.height;

      const cropX = (overlayRect.left - imgRect.left) * scaleX;
      const cropY = (overlayRect.top - imgRect.top) * scaleY;
      const cropWidth = overlayRect.width * scaleX;
      const cropHeight = overlayRect.height * scaleY;

      const croppedResult = await cropImage({
        file,
        crop: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
        outputWidth: targetWidth,
        outputHeight: targetHeight,
        onProgress: (fraction) => setCropProgress(fraction),
      });

      finish(croppedResult);
    } catch (err) {
      console.error("Cropping failed:", err);
      finish(file);
    }
  };

  const handleUploadOriginalGif = () => {
    onConfirm(file);
  };

  const title =
    type === "server-icon"
      ? t("dialogs.serverSettings.overview.serverIcon")
      : type === "avatar"
        ? t("crop.avatarTitle")
        : t("crop.bannerTitle");
  const subtitle = t("crop.dragAndZoomHint");

  return (
    <Modal wide title={title} subtitle={subtitle} onClose={onClose}>
      <div className="image-crop-dialog">
        {/* Viewport container with mask */}
        <div
          className={`image-crop-viewport image-crop-viewport--${type}`}
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        >
          {imageSrc ? (
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop preview"
              className="image-crop-preview-img"
              onLoad={onImageLoad}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                pointerEvents: "none",
                userSelect: "none",
              }}
              draggable={false}
            />
          ) : null}

          {/* Mask Guide Overlay with reference */}
          <div
            ref={overlayRef}
            className={`image-crop-overlay image-crop-overlay--${type}`}
          />
        </div>

        {/* Zoom Controls */}
        <div className="image-crop-controls">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setZoom((prev) => Math.max(0.2, Number((prev - 0.15).toFixed(2))))}
            title={t("crop.zoomOut")}
            disabled={processing}
          >
            −
          </button>
          <input
            type="range"
            min="0.2"
            max="4"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="image-crop-slider"
            disabled={processing}
          />
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setZoom((prev) => Math.min(4, Number((prev + 0.15).toFixed(2))))}
            title={t("crop.zoomIn")}
            disabled={processing}
          >
            +
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title={t("crop.reset")}
            disabled={processing}
          >
            <RotateCcwIcon size={14} />
          </button>
        </div>

        {/* GIF animation preservation notice */}
        {isGif ? (
          <div className="alert alert--info" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SparklesIcon size={18} />
            <span style={{ fontSize: 13 }}>
              {t("crop.gifNotice")}
            </span>
          </div>
        ) : null}

        {/* Encoding progress bar for animated GIFs */}
        {isGif && processing && cropProgress !== null ? (
          <div className="image-crop-progress">
            <div className="image-crop-progress__label">
              <span>{t("crop.cropping")}</span>
              <span>{Math.round(cropProgress * 100)}%</span>
            </div>
            <div className="image-crop-progress__bar">
              <div
                className="image-crop-progress__fill"
                style={{ width: `${Math.round(cropProgress * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Footer Actions */}
        <div className="image-crop-footer">
          <div className="image-crop-footer__left">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onClose}
              disabled={processing}
            >
              {t("common.cancel")}
            </button>

            {isGif ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={handleUploadOriginalGif}
                disabled={processing}
                title={t("crop.uploadOriginalGifTip")}
              >
                <UploadIcon size={16} />
                <span>{t("crop.uploadOriginal")}</span>
              </button>
            ) : null}
          </div>

          <div className="image-crop-footer__right">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleApplyCropped()}
              disabled={processing}
            >
              <CheckIcon size={16} />
              <span>
                {processing
                  ? cropProgress !== null
                    ? `${t("crop.cropping")} ${Math.round(cropProgress * 100)}%`
                    : t("common.loading")
                  : t("crop.applyCrop")}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
