import { useState, useRef, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import { Modal } from "../Modal";
import { SparklesIcon, RotateCcwIcon, CheckIcon, UploadIcon } from "../Icons";

interface ImageCropDialogProps {
  file: File;
  type: "avatar" | "banner";
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

  // Pointer event handlers for silky-smooth dragging on all devices
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

  const handleApplyCropped = async () => {
    if (!imgRef.current || !containerRef.current) {
      onConfirm(file);
      return;
    }
    setProcessing(true);

    try {
      const img = imgRef.current;
      const overlay = overlayRef.current ?? containerRef.current;
      const overlayRect = overlay.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();

      // Desired output dimensions
      const targetWidth = type === "avatar" ? 384 : 960;
      const targetHeight = type === "avatar" ? 384 : 320;

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        onConfirm(file);
        return;
      }

      // Scale ratio between on-screen displayed image and natural image pixels
      const scaleX = img.naturalWidth / imgRect.width;
      const scaleY = img.naturalHeight / imgRect.height;

      // Crop coordinates relative to the natural image
      const cropX = (overlayRect.left - imgRect.left) * scaleX;
      const cropY = (overlayRect.top - imgRect.top) * scaleY;
      const cropWidth = overlayRect.width * scaleX;
      const cropHeight = overlayRect.height * scaleY;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        targetWidth,
        targetHeight,
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onConfirm(file);
            return;
          }
          const outputExt = file.type === "image/png" ? "png" : "webp";
          const outputType = file.type === "image/png" ? "image/png" : "image/webp";
          const croppedFile = new File([blob], `${file.name.replace(/\.[^/.]+$/, "")}.${outputExt}`, {
            type: outputType,
            lastModified: Date.now(),
          });
          onConfirm(croppedFile);
        },
        file.type === "image/png" ? "image/png" : "image/webp",
        0.92,
      );
    } catch {
      onConfirm(file);
    }
  };

  const handleUploadOriginalGif = () => {
    onConfirm(file);
  };

  const title = type === "avatar" ? t("crop.avatarTitle") : t("crop.bannerTitle");
  const subtitle = t("crop.dragAndZoomHint");

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
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

        {/* Zoom Controls (Active for both static images and previewing GIFs) */}
        <div className="image-crop-controls">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setZoom((prev) => Math.max(0.2, Number((prev - 0.15).toFixed(2))))}
            title="Zoom Out"
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
          />
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => setZoom((prev) => Math.min(4, Number((prev + 0.15).toFixed(2))))}
            title="Zoom In"
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
          >
            <RotateCcwIcon size={14} />
          </button>
        </div>

        {/* GIF animation preservation notice */}
        {isGif ? (
          <div className="alert alert--info" style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
            <SparklesIcon size={18} />
            <span style={{ fontSize: 13 }}>
              {t("crop.gifNotice")}
            </span>
          </div>
        ) : null}

        {/* Footer Actions */}
        <div className="image-crop-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={processing}>
            {t("common.cancel")}
          </button>

          {isGif ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleUploadOriginalGif}
              disabled={processing}
            >
              <UploadIcon size={16} />
              <span>Subir GIF Original (Animado)</span>
            </button>
          ) : null}

          <button
            type="button"
            className={isGif ? "btn btn--ghost" : "btn btn--primary"}
            onClick={() => void handleApplyCropped()}
            disabled={processing}
          >
            <CheckIcon size={16} />
            <span>{processing ? t("common.loading") : isGif ? "Recortar Estático (WebP)" : t("common.save")}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
