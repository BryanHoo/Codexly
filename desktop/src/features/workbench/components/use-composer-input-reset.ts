import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import { createComposerDraftBinding } from "../project-draft-binding.js";
import {
  isPromptSkillContentEmpty,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";

export function useComposerInputReset({
  binding,
  handleAttachmentsChange,
  historyDraftRef,
  replacePromptContent,
  setAttachments,
  setHistoryIndex,
  setPromptContent,
  skillEditorRef,
}: Readonly<{
  binding: ReturnType<typeof createComposerDraftBinding>;
  handleAttachmentsChange: (files: readonly PromptInputAttachment[]) => void;
  historyDraftRef: RefObject<PromptSkillContent>;
  replacePromptContent: (content: PromptSkillContent) => void;
  setAttachments: Dispatch<SetStateAction<readonly PromptInputAttachment[]>>;
  setHistoryIndex: Dispatch<SetStateAction<number | null>>;
  setPromptContent: Dispatch<SetStateAction<PromptSkillContent>>;
  skillEditorRef: RefObject<PromptSkillEditorHandle | null>;
}>) {
  const clearComposerInput = useCallback(() => {
    setPromptContent([]);
    setHistoryIndex(null);
    historyDraftRef.current = [];
    setAttachments([]);
    skillEditorRef.current?.replace([]);
    // 编辑器同步完成后再删持久草稿，避免变更回调重新写入旧内容。
    binding.clear();
  }, [binding, historyDraftRef, setAttachments, setHistoryIndex, setPromptContent, skillEditorRef]);

  const restoreComposerInput = useCallback((content: PromptSkillContent, files: readonly PromptInputAttachment[]) => {
    const current = binding.read();
    // 慢请求失败时不能覆盖用户已开始编写的下一条消息。
    if (!isPromptSkillContentEmpty(current.content) || current.attachments.length > 0) return;
    replacePromptContent(content);
    handleAttachmentsChange(files);
  }, [binding, handleAttachmentsChange, replacePromptContent]);

  return { clearComposerInput, restoreComposerInput } as const;
}
