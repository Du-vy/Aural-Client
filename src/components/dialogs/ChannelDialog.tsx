import { useMemo, useState, type FormEvent } from "react";

import { describeError, type ChannelType } from "@/lib/protocol";
import { useSession } from "@/store/session";
import { Modal } from "../Modal";

interface ChannelDialogProps {
  /** Category the new channel starts in, or null for the tree root. */
  parentId: number | null;
  onClose(): void;
}

export function ChannelDialog({ parentId, onClose }: ChannelDialogProps) {
  const channels = useSession((state) => state.channels);
  const createChannel = useSession((state) => state.createChannel);

  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("voice");
  const [parent, setParent] = useState<number | null>(parentId);
  const [userLimit, setUserLimit] = useState(0);
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
      await createChannel({
        name: name.trim(),
        type,
        // Categories always live at the root of the tree.
        parentId: type === "category" ? null : parent,
        userLimit: type === "voice" ? userLimit : 0,
      });
      onClose();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Create a channel"
      subtitle="Voice channels carry presence; text channels arrive in v0.2."
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form="create-channel"
            disabled={busy || name.trim() === ""}
          >
            Create
          </button>
        </>
      }
    >
      <form
        id="create-channel"
        onSubmit={(event) => void submit(event)}
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {error ? <p className="alert">{error}</p> : null}

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
            <option value="voice">Voice channel</option>
            <option value="text">Text channel</option>
            <option value="category">Category</option>
          </select>
        </div>

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
            placeholder={type === "category" ? "General" : type === "voice" ? "Lobby" : "general"}
            required
          />
        </div>

        {type !== "category" ? (
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
