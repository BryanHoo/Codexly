import { createContext, useContext } from "react";
import type { AgentAttachment } from "@code-agent/protocol";
import type { AttachmentData } from "./attachments.js";

export type PromptInputAttachment = AttachmentData &
  Readonly<{ file: File; source: "browser" } | { attachment: AgentAttachment; source: "host" }>;

export type BrowserPromptInputAttachment = Extract<
  PromptInputAttachment,
  Readonly<{ source: "browser" }>
>;

export type PromptInputMessage = Readonly<{
  files: readonly PromptInputAttachment[];
  text: string;
}>;

export type PromptInputKeyEvent = Readonly<{
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}>;

export type PromptInputNativeKeyEvent = Readonly<{
  isComposing: boolean;
  keyCode: number;
}>;

export function isPromptInputComposing(event: PromptInputNativeKeyEvent): boolean {
  // WebKit 会在候选确认的 Enter 前提前结束 composition，但仍用 229 标记该 IME 按键。
  return event.isComposing || event.keyCode === 229;
}

export function isPromptInputNewlineShortcut(event: PromptInputKeyEvent): boolean {
  // 同时覆盖 macOS 的 Command、Windows/Linux 的 Control 和通用 Shift 换行操作。
  return event.key === "Enter" && (event.shiftKey || event.metaKey || event.ctrlKey);
}

export type PromptInputError = Readonly<{
  code: "file_too_large" | "invalid_file_type" | "too_many_images" | "total_size_exceeded";
  message: string;
}>;

export type PromptInputAttachmentKind = "file" | "image";

export type PromptInputAttachmentsContextValue = Readonly<{
  clear: () => void;
  disabled: boolean;
  files: readonly PromptInputAttachment[];
  remove: (id: string) => void;
}>;

export const PromptInputAttachmentsContext = createContext<
  PromptInputAttachmentsContextValue | undefined
>(undefined);

export function usePromptInputAttachments() {
  const context = useContext(PromptInputAttachmentsContext);
  if (context === undefined) {
    throw new Error("usePromptInputAttachments must be used inside PromptInput");
  }
  return context;
}
