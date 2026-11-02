import { createMessageEditDraftAction } from "@codexly/frontend-core/message-edit-draft";
import type { AgentSkill } from "@codexly/protocol";
import { createFollowupDraftAction } from "@codexly/frontend-core/followup-draft";
import type { useComposerSession } from "./workbench-composer-session.js";

function createComposerFollowup(session: ReturnType<typeof useComposerSession>) {
  return createFollowupDraftAction({
    disabled: session.draftInputDisabled,
    read: () => session.skillEditorRef.current?.getContent() ?? session.promptContent,
    replace: session.replacePromptContent,
    // 编辑器现有 focus 会展开所属分屏输入框，不操作其他聊天的 DOM。
    focus: () => session.skillEditorRef.current?.focus(),
  });
}

function createMessageEdit(
  session: ReturnType<typeof useComposerSession>,
  skills: readonly AgentSkill[],
) {
  return createMessageEditDraftAction({
    disabled: session.draftInputDisabled,
    skills,
    replace: (content) => {
      session.setPromptHistoryIndex(null);
      session.closeCommandMenu();
      session.closeFileMenu();
      // 不改变附件和发送设置；正文替换及草稿持久化复用现有编辑器入口。
      session.replacePromptContent(content);
    },
    focus: () => session.skillEditorRef.current?.focus(),
  });
}

export function createComposerDraftActions(
  session: ReturnType<typeof useComposerSession>,
  skills: readonly AgentSkill[],
) {
  return {
    insertFollowup: createComposerFollowup(session),
    editMessage: createMessageEdit(session, skills),
  };
}
