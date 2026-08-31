import { useMemo, useState, type FormEvent } from "react";

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
            ? "Edit Category"
            : "Edit Channel"
          : isCategory
            ? "Create a category"
            : "Create a channel"
      }
      subtitle={
        isEditing
          ? "Update name and channel settings."
          : "Voice channels carry audio; text channels store chat history."
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form="channel-form"
            disabled={busy || name.trim() === ""}
          >
            {isEditing ? "Save Changes" : "Create"}
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
              Type
            </label>
            <select
              id="channel-type"
              className="select"
              value={type}
              onChange={(event) => setType(event.target.value as ChannelType)}
            >
              <option value="text">Text channel</option>
              <option value="voice">Voice channel</option>
              <option value="category">Category</option>
            </select>
          </div>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor="channel-name">
            Name
          </label>
          <input
            id="channel-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            placeholder={isCategory ? "General" : type === "voice" ? "Lobby" : "general"}
            required
            autoFocus
          />
        </div>

        {!isCategory ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-topic">
              Topic (optional)
            </label>
            <input
              id="channel-topic"
              className="input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={1024}
              placeholder="What's this channel about?"
            />
          </div>
        ) : null}

        {!isEditing && !isCategory ? (
          <div className="field">
            <label className="field__label" htmlFor="channel-parent">
              Category
            </label>
            <select
              id="channel-parent"
              className="select"
              value={parent === null ? "" : String(parent)}
              onChange={(event) => setParent(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">No category</option>
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
              User limit
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
            <span className="field__hint">0 means no limit.</span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
