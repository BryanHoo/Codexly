import type { EditableUserMessage } from "@codexly/frontend-core/message-edit-draft";
import { Pencil } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { MessageAction } from "../agent/message.js";

const MessageEditContext = createContext<((message: EditableUserMessage) => void) | null>(null);

export function MessageEditProvider({
  children,
  onEdit,
}: Readonly<{
  children: ReactNode;
  onEdit: ((message: EditableUserMessage) => void) | null;
}>) {
  // 动作绑定所属会话，分屏之间不共享草稿或焦点，也不订阅输入框的逐字变化。
  return <MessageEditContext.Provider value={onEdit}>{children}</MessageEditContext.Provider>;
}

export function MessageEditAction({
  message,
  label,
}: Readonly<{
  message: EditableUserMessage;
  label: string;
}>) {
  const edit = useContext(MessageEditContext);
  if (edit === null || (message.text === "" && !message.skills?.length)) return null;
  return (
    <MessageAction
      label={label}
      tooltip={label}
      onClick={() => {
        edit(message);
      }}
    >
      <Pencil aria-hidden="true" className="size-3.5" />
    </MessageAction>
  );
}
