import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { describeError, type UserStatus } from "@/lib/protocol";
import { Avatar } from "./Avatar";
import { CheckIcon, GearIcon, SparklesIcon } from "./Icons";

interface StatusPopoverProps {
  onClose(): void;
  onOpenSettings(): void;
}

type PresenceStatus = "online" | "idle" | "dnd" | "invisible";

interface StatusOption {
  id: PresenceStatus;
  titleKey: "status.online" | "status.idle" | "status.dnd" | "status.invisible";
  descKey: "status.onlineDesc" | "status.idleDesc" | "status.dndDesc" | "status.invisibleDesc";
  color: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  {
    id: "online",
    titleKey: "status.online",
    descKey: "status.onlineDesc",
    color: "#23a55a",
  },
  {
    id: "idle",
    titleKey: "status.idle",
    descKey: "status.idleDesc",
    color: "#f0b232",
  },
  {
    id: "dnd",
    titleKey: "status.dnd",
    descKey: "status.dndDesc",
    color: "#f23f43",
  },
  {
    id: "invisible",
    titleKey: "status.invisible",
    descKey: "status.invisibleDesc",
    color: "#80848e",
  },
];

export function StatusPopover({ onClose, onOpenSettings }: StatusPopoverProps) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const setStatus = useSession((state) => state.setStatus);
  const updateProfile = useSession((state) => state.updateProfile);

  const [customStatus, setCustomStatus] = useState(self?.customStatus ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCustom, setEditingCustom] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const currentStatus: UserStatus = (self?.status as UserStatus) || "online";

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!self) return null;

  async function handleSelectStatus(status: PresenceStatus) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setStatus(status);
      onClose();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCustomStatus(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ customStatus: customStatus.trim() });
      setEditingCustom(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleClearCustomStatus() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ customStatus: "" });
      setCustomStatus("");
      setEditingCustom(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="status-popover-scrim" onClick={onClose}>
      <div
        ref={popoverRef}
        className="status-popover animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("status.title")}
      >
        {/* Header: User summary */}
        <div className="status-popover__header">
          <Avatar user={self} size="md" status={currentStatus} />
          <div className="status-popover__user-info">
            <span className="status-popover__nickname">{self.nickname}</span>
            <span className="status-popover__username">
              {self.registered ? `@${self.username}` : t("common.guest")}
            </span>
          </div>
        </div>

        {error ? <div className="alert alert--danger">{error}</div> : null}

        {/* Custom status field */}
        <div className="status-popover__custom-status">
          {editingCustom ? (
            <form onSubmit={handleSaveCustomStatus} className="status-popover__custom-form">
              <input
                className="input input--sm"
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder={t("status.customPlaceholder")}
                maxLength={128}
                autoFocus
              />
              <div className="status-popover__custom-actions">
                <button type="submit" className="btn btn--sm btn--primary" disabled={busy}>
                  {t("common.save")}
                </button>
                {self.customStatus ? (
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={handleClearCustomStatus}
                    disabled={busy}
                  >
                    {t("common.delete")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setEditingCustom(false)}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="status-popover__custom-btn"
              onClick={() => setEditingCustom(true)}
            >
              <SparklesIcon size={14} />
              <span className="status-popover__custom-text">
                {self.customStatus || t("status.setCustomStatus")}
              </span>
            </button>
          )}
        </div>

        <div className="status-popover__divider" />

        {/* Status options list */}
        <div className="status-popover__options" role="radiogroup">
          {STATUS_OPTIONS.map((option) => {
            const isSelected = currentStatus === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`status-popover__option ${isSelected ? "status-popover__option--active" : ""}`}
                onClick={() => void handleSelectStatus(option.id)}
                disabled={busy}
                role="radio"
                aria-checked={isSelected}
              >
                <span className="status-popover__option-dot-wrap">
                  <span
                    className={`status-popover__dot status-popover__dot--${option.id}`}
                    style={{ backgroundColor: option.id === "invisible" ? "transparent" : option.color }}
                  >
                    {option.id === "dnd" ? (
                      <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                        <circle cx="5" cy="5" r="5" fill="#f23f43" />
                        <rect x="2" y="4" width="6" height="2" rx="0.75" fill="#ffffff" />
                      </svg>
                    ) : option.id === "idle" ? (
                      <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                        <circle cx="5" cy="5" r="5" fill="#f0b232" />
                        <path d="M6.8 1.5A4 4 0 1 0 8.5 7.2 4.5 4.5 0 0 1 6.8 1.5z" fill="#1e1f22" opacity="0.9" />
                      </svg>
                    ) : option.id === "invisible" ? (
                      <svg viewBox="0 0 10 10" className="avatar__badge-icon">
                        <circle cx="5" cy="5" r="3.75" fill="none" stroke="#80848e" strokeWidth="2.2" />
                      </svg>
                    ) : null}
                  </span>
                </span>
                <div className="status-popover__option-text">
                  <span className="status-popover__option-title">{t(option.titleKey)}</span>
                  <span className="status-popover__option-desc">{t(option.descKey)}</span>
                </div>
                {isSelected ? (
                  <span className="status-popover__option-check">
                    <CheckIcon size={16} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="status-popover__divider" />

        {/* Footer: Link to Settings */}
        <div className="status-popover__footer">
          <button
            type="button"
            className="status-popover__footer-btn"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
          >
            <GearIcon size={15} />
            <span>{t("dialogs.userSettings.tabProfile")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
