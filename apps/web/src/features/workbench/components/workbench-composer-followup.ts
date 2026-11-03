import { createElement } from "react";
import { PromptOptimizationButton } from "@codexly/ui/core/prompt-optimization-button";
import {
  createPromptSkillContent,
  serializePromptSkillContent,
  recognizePromptSkillReferences,
} from "./prompt-skill-content.js";
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

/** 共享按钮只接受字符串；平台适配负责正文、Skill 和持久草稿的同步替换。 */
export function optimizeButton(
  session: ReturnType<typeof useComposerSession>,
  client: { optimizePrompt?: (projectId: string, text: string) => Promise<{ text: string }> },
  projectId: string,
  skills: readonly AgentSkill[],
  language: string,
) {
  const generate = client.optimizePrompt?.bind(client);
  if (!generate) return undefined;
  return createElement(PromptOptimizationButton, {
    language,
    scope: session.composerScope,
    text: serializePromptSkillContent(session.promptContent),
    disabled: session.draftInputDisabled || session.isSubmitting,
    generate: (text) => generate(projectId, text),
    replace: (text) => {
      session.closeCommandMenu();
      session.closeFileMenu();
      session.replacePromptContent(
        recognizePromptSkillReferences(createPromptSkillContent(text), skills),
      );
      session.skillEditorRef.current?.focus();
    },
    onError: session.setMutationError,
  });
}
