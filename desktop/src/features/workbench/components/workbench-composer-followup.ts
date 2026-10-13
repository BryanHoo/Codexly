import { createFollowupDraftAction } from "@codexly/frontend-core/followup-draft";
import type { useComposerSession } from "./workbench-composer-session.js";

export function createComposerFollowup(session: ReturnType<typeof useComposerSession>) {
  return createFollowupDraftAction({
    disabled: session.draftInputDisabled,
    read: () => session.skillEditorRef.current?.getContent() ?? session.promptContent,
    replace: session.replacePromptContent,
    // 编辑器现有 focus 会展开所属分屏输入框，不操作其他聊天的 DOM。
    focus: () => session.skillEditorRef.current?.focus(),
  });
}
