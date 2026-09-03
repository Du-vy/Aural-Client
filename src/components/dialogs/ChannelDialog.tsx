import { useMemo, useState, type FormEvent } from "react";

import { useTranslation } from "@/lib/i18n";
import { describeError, type ChannelType } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { Modal } from "../Modal";

interface ChannelDialogProps {
  /** Category the new channel starts in, or null for the tree root. */
  parentId?: number | null;
  initialType?: ChannelType;
  /** If provided, edits an existing channel instead of creating a new one. */
  editChannelId?: number;
  onClose(): void;
}

export function ChannelDialog({
  parentId = null,
  initialType,
  editChannelId,
  onClose,
}: ChannelDialogProps) {
  const { t } = useTranslation();
  const channels = useSession((state) => state.channels);
  const createChannel = useSession((state) => state.createChannel);
  const updateChannel = useSession((state) => state.updateChannel);

  const existing = editChannelId !== undefined ? channels.get(editChannelId) : undefined;
  const isEditing = existing !== undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [topic, setTopic] = useState(existing?.topic ?? "");
  const [type, setType] = useState<ChannelType>(existing?.type ?? initialType ?? "text");
  const [parent, setParent] = useState<number | null>(existing?.parentId ?? parentId);
  const [userLimit, setUserLimit] = useState(existing?.userLimit ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () =>
      [...channels.values()]
        .filter((channel) => channel.type === "category")
        .sort((a, b) => a.position - b.position),
    [channels],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isEditing && editChannelId !== undefined) {
        await updateChannel({
          channelId: editChannelId,
          name: name.trim(),
          topic: topic.trim(),
          userLimit: type === "voice" ? userLimit : undefined,
        });
      } else {
        await createChannel({
          name: name.trim(),
          type,
          // Categories always live at the root of the tree.
          parentId: type === "category" ? null : parent,
          userLimit: type === "voice" ? userLimit : 0,
        });
      }
      onClose();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  const isCategory = type === "category";

  return (
    <Modal
      title={
        isEditing
          ? isCategory
            ? t("dialogs.channel.editCategoryTitle")
            : t("dialogs.channel.editTitle")
          : isCategory
            ? t("dialogs.channel.createCategoryTitle")
            : t("dialogs.channel.createTitle")
      }
      subtitle={
        isEditing
          ? undefined
          : isCategory
            ? t("dialogs.channel.categoryTypeDesc")
            : type === "voice"
              ? t("dialogs.channel.voiceTypeDesc")
              : type === "announcement"
                ? t("dialogs.channel.announcementTypeDesc")
                : type === "calendar"
                  ? t("dialogs.channel.calendarTypeDesc")
                  : type === "forum"
                    ? t("dialogs.channel.forumTypeDesc")
                    : type === "media"
                      ? t("dialogs.channel.mediaTypeDesc")
                      : t("dialogs.channel.textTypeDesc")
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} type="button">
            {t("common.cancel")}
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form="channel-form"
            disabled={busy || name.trim() === ""}
          >
            {isEditing
              ? t("common.save")
              : isCategory
                ? t("dialogs.channel.createCategory")
                : t("dialogs.channel.create")}
          </button>
        </>
      }
    >
      <form
        id="channel-form"
        onSubmit={(event) => void submit(event)}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {error ? <p className="alert">{error}</p> : null}

        {!isEditing ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-type">
              {t("dialogs.channel.channelType")}
            </label>
            <select
              id="channel-type"
              className="select"
              value={type}
              onChange={(event) => setType(event.target.value as ChannelType)}
            >
              <option value="text">{t("dialogs.channel.textType")}</option>
              <option value="voice">{t("dialogs.channel.voiceType")}</option>
              <option value="announcement">{t("dialogs.channel.announcementType")}</option>
              <option value="calendar">{t("dialogs.channel.calendarType")}</option>
              <option value="forum">{t("dialogs.channel.forumType")}</option>
              <option value="media">{t("dialogs.channel.mediaType")}</option>
              <option value="category">{t("dialogs.channel.categoryType")}</option>
            </select>
          </div>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="channel-name">
            {isCategory ? t("dialogs.channel.categoryName") : t("dialogs.channel.channelName")}
          </label>
          <input
            id="channel-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder={
              isCategory
                ? t("dialogs.channel.categoryNamePlaceholder")
                : type === "voice"
                  ? "Lobby"
                  : type === "announcement"
                    ? "announcements"
                    : type === "calendar"
                      ? "events"
                      : type === "forum"
                        ? "discussions"
                        : type === "media"
                          ? "gallery"
                          : t("dialogs.channel.channelNamePlaceholder")
            }
            required
            autoFocus
          />
        </div>

        {!isCategory ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-topic">
              {t("dialogs.channel.channelTopic")}
            </label>
            <input
              id="channel-topic"
              className="input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={1024}
              placeholder={t("dialogs.channel.channelTopicPlaceholder")}
            />
          </div>
        ) : null}

        {!isEditing && !isCategory ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-parent">
              {t("dialogs.channel.parentCategory")}
            </label>
            <select
              id="channel-parent"
              className="select"
              value={parent === null ? "" : String(parent)}
              onChange={(event) => setParent(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">{t("dialogs.channel.noCategory")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {type === "voice" ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-limit">
              {t("dialogs.channel.userLimit")}
            </label>
            <input
              id="channel-limit"
              className="input"
              type="number"
              min={0}
              max={1000}
              value={userLimit}
              onChange={(event) => setUserLimit(Number(event.target.value))}
            />
            <span className="field__hint">0 = {t("dialogs.channel.noLimit")}</span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

