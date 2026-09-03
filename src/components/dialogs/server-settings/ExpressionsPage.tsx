import { useMemo, useRef, useState } from "react";

import { expressionUrl } from "@/lib/customEmoji";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError, type Expression, type ExpressionKind } from "@/lib/protocol";
import { formatBytes, parseBytes } from "@/lib/uploads";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { PencilIcon, SmileyIcon, StickerIcon, TrashIcon, UploadIcon } from "../../Icons";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * Custom emoji and stickers.
 *
 * One screen for both, because they are one namespace with one set of rules:
 * they differ in where a client draws them — an emoji goes inline in a line of
 * text, a sticker is the whole of a message — and in nothing else.
 */
export function ServerExpressionsPage() {
  const { t } = useTranslation();
  const expressions = useSession((state) => state.expressions);
  const server = useSession((state) => state.server);

  const permissions = useMyPermissions();
  const allowed = has(permissions, Perm.ManageExpressions);

  const limits = server?.expressions;
  const emoji = useMemo(
    () => [...expressions.values()].filter((item) => item.kind === "emoji"),
    [expressions],
  );
  const stickers = useMemo(
    () => [...expressions.values()].filter((item) => item.kind === "sticker"),
    [expressions],
  );

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.emojis.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.emojis.desc")}</p>
      </header>

      <ExpressionGroup
        kind="emoji"
        items={emoji}
        allowed={allowed}
        limit={limits?.maxEmojis ?? 0}
        maxBytes={parseBytes(limits?.maxEmojiBytes)}
      />
      <ExpressionGroup
        kind="sticker"
        items={stickers}
        allowed={allowed}
        limit={limits?.maxStickers ?? 0}
        maxBytes={parseBytes(limits?.maxStickerBytes)}
      />
    </div>
  );
}

interface GroupProps {
  kind: ExpressionKind;
  items: Expression[];
  allowed: boolean;
  limit: number;
  maxBytes: number;
}

function ExpressionGroup({ kind, items, allowed, limit, maxBytes }: GroupProps) {
  const { t } = useTranslation();
  const address = useSession((state) => state.address);
  const uploadExpression = useSession((state) => state.uploadExpression);
  const renameExpression = useSession((state) => state.renameExpression);
  const deleteExpression = useSession((state) => state.deleteExpression);

  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Expression | null>(null);
  const [draftName, setDraftName] = useState("");
  const [removing, setRemoving] = useState<Expression | null>(null);

  const full = limit > 0 && items.length >= limit;

  async function onPicked(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (maxBytes > 0 && file.size > maxBytes) {
      setError(t("dialogs.serverSettings.emojis.tooLarge", { size: formatBytes(maxBytes) }));
      return;
    }

    // The file name is the name, cleaned down to what the server accepts: it
    // is nearly always right, and typing it again for every upload is the kind
    // of friction that stops people using the feature at all.
    const name = suggestName(file.name);
    if (!name) {
      setError(t("dialogs.serverSettings.emojis.badName"));
      return;
    }

    setBusy(true);
    try {
      await uploadExpression(kind, name, file);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function commitRename() {
    if (!renaming) return;
    setError(null);
    try {
      await renameExpression(renaming.id, draftName.trim().toLowerCase());
      setRenaming(null);
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  async function remove(item: Expression) {
    setError(null);
    try {
      await deleteExpression(item.id);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-card__header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <span
            className="settings-card__service-icon"
            aria-hidden="true"
            style={{
              width: 38,
              height: 38,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--accent-soft)",
              color: "var(--accent)",
              flexShrink: 0,
            }}
          >
            {kind === "emoji" ? <SmileyIcon size={20} /> : <StickerIcon size={20} />}
          </span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 className="settings-card__title" style={{ margin: 0 }}>
                {t(`dialogs.serverSettings.emojis.${kind}Title` as never)}
              </h3>
              <span className="settings-badge" style={{ background: "var(--bg-overlay)", border: "1px solid var(--border)", fontSize: 11 }}>
                {items.length} / {limit || "∞"}
              </span>
            </div>
            <p className="settings-card__subtitle" style={{ marginTop: 2 }}>
              {t("dialogs.serverSettings.emojis.slotsAvailable", {
                used: items.length,
                total: limit,
              })}
              {maxBytes > 0 ? ` · ${t("dialogs.serverSettings.emojis.maxSize", {
                size: formatBytes(maxBytes),
              })}` : ""}
            </p>
          </div>
        </div>

        {allowed ? (
          <>
            <input
              ref={picker}
              type="file"
              accept="image/png,image/gif,image/webp,image/jpeg"
              hidden
              onChange={(event) => {
                void onPicked(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || full}
              onClick={() => picker.current?.click()}
            >
              <UploadIcon size={15} />
              {busy ? t("common.loading") : t("dialogs.serverSettings.emojis.uploadButton")}
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="settings-inline-error">{error}</p> : null}
      {full ? (
        <p className="settings-card__subtitle" style={{ marginTop: 10 }}>{t("dialogs.serverSettings.emojis.full")}</p>
      ) : null}

      {items.length === 0 ? (
        <div style={{ padding: "28px 16px", textAlign: "center", background: "var(--bg-input)", border: "1px dashed var(--border)", borderRadius: "var(--radius-md)", marginTop: 14 }}>
          <p className="settings-card__subtitle" style={{ margin: 0 }}>{t("dialogs.serverSettings.emojis.empty")}</p>
        </div>
      ) : (
        <ul className="expression-grid">
          {items.map((item) => (
            <li key={item.id} className="expression-tile">
              <img
                src={expressionUrl(address, item)}
                alt={item.name}
                className={
                  kind === "sticker" ? "expression-tile__img expression-tile__img--large" : "expression-tile__img"
                }
                loading="lazy"
                draggable={false}
              />
              <span className="expression-tile__name" title={`:${item.name}:`}>
                :{item.name}:
              </span>
              {allowed ? (
                <span className="expression-tile__actions">
                  <button
                    type="button"
                    className="iconbtn iconbtn--sm"
                    title={t("common.edit")}
                    onClick={() => {
                      setRenaming(item);
                      setDraftName(item.name);
                    }}
                  >
                    <PencilIcon size={13} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn iconbtn--sm iconbtn--danger"
                    title={t("common.delete")}
                    onClick={() => setRemoving(item)}
                  >
                    <TrashIcon size={13} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {renaming ? (
        <div className="settings-card settings-card--inset">
          <div className="field">
            <label className="field__label" htmlFor={`rename-${renaming.id}`}>
              {t("dialogs.serverSettings.emojis.nameLabel")}
            </label>
            <div className="field__row">
              <input
                id={`rename-${renaming.id}`}
                className="input"
                value={draftName}
                autoFocus
                spellCheck={false}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void commitRename();
                  if (event.key === "Escape") setRenaming(null);
                }}
              />
              <button type="button" className="btn btn--primary" onClick={() => void commitRename()}>
                {t("common.save")}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setRenaming(null)}>
                {t("common.cancel")}
              </button>
            </div>
            <p className="field__hint">{t("dialogs.serverSettings.emojis.nameHint")}</p>
          </div>
        </div>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={t("common.delete")}
          subtitle={t("dialogs.serverSettings.emojis.deleteConfirm", { name: removing.name })}
          confirmText={t("common.delete")}
          danger
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Turns a file name into a name writers can type.
 *
 * The rule matches what the server accepts — letters, digits and underscores —
 * so anything else becomes an underscore rather than being refused: somebody
 * uploading `party parrot.gif` means `party_parrot`.
 */
function suggestName(filename: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  const cleaned = stem
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (cleaned.length < 2) return "";
  return cleaned.slice(0, 32);
}
