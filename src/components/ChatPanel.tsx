import { useEffect } from "react";

import { Perm, has } from "@/lib/permissions";
import type { Channel } from "@/lib/protocol";
import { EMPTY_HISTORY, useSession } from "@/store/session";
import { useChannelPermissions } from "@/store/selectors";
import { MessageComposer } from "./MessageComposer";
import { MessageList } from "./MessageList";

interface ChatPanelProps {
  channel: Channel;
}

/** One text channel: its history, and the box to add to it. */
export function ChatPanel({ channel }: ChatPanelProps) {
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const self = useSession((state) => state.self);
  const history = useSession((state) => state.history.get(channel.id)) ?? EMPTY_HISTORY;

  const openChannel = useSession((state) => state.openChannel);
  const loadOlder = useSession((state) => state.loadOlder);
  const sendMessage = useSession((state) => state.sendMessage);
  const editMessage = useSession((state) => state.editMessage);
  const deleteMessage = useSession((state) => state.deleteMessage);

  const permissions = useChannelPermissions(channel.id);
  const canSend = has(permissions, Perm.SendMessages);
  const canManageMessages = has(permissions, Perm.ManageMessages);

  // History is fetched the first time a channel is opened and then kept, so
  // switching back and forth does not re-fetch what is already held.
  useEffect(() => {
    void openChannel(channel.id);
  }, [channel.id, openChannel]);

  return (
    <div className="chatpanel">
      <MessageList
        channelName={channel.name}
        messages={history.messages}
        users={users}
        roles={roles}
        selfId={self?.id ?? null}
        hasMore={history.hasMore}
        loading={history.loading}
        error={history.error}
        canManageMessages={canManageMessages}
        onLoadOlder={() => void loadOlder(channel.id)}
        onEdit={(messageId, content) => void editMessage(messageId, content)}
        onDelete={(messageId) => void deleteMessage(messageId)}
      />

      <MessageComposer
        channelName={channel.name}
        disabledReason={canSend ? null : "You do not have permission to send messages here."}
        onSend={(content) => sendMessage(channel.id, content)}
      />
    </div>
  );
}
