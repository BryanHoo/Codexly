import type { AgentSkill, PromptDocumentPart } from "@codexly/protocol";

export type EditableUserMessage = Readonly<{
  text: string;
  skills?: readonly Readonly<{ name: string }>[];
}>;

export function createMessageEditDraftAction({
  disabled,
  skills,
  replace,
  focus,
}: Readonly<{
  disabled: boolean;
  skills: readonly AgentSkill[];
  replace: (content: readonly PromptDocumentPart[]) => void;
  focus: () => void;
}>): (message: EditableUserMessage) => void {
  return (message) => {
    if (disabled || (message.text === "" && !message.skills?.length)) return;
    const parts: PromptDocumentPart[] = [];
    const references = message.skills ?? [];
    for (const [index, reference] of references.entries()) {
      const skill = skills.find((candidate) => candidate.name === reference.name);
      parts.push(
        skill === undefined
          ? { type: "text", text: `$${reference.name}` }
          : { type: "skill", skill },
      );
      if (index < references.length - 1 || message.text !== "") {
        parts.push({ type: "text", text: " " });
      }
    }
    if (message.text !== "") parts.push({ type: "text", text: message.text });
    // 仅回填当前输入草稿，不持有消息 ID、不触碰历史或发送接口。
    // 历史附件展示地址不具备重新提交权限，沿用提示词历史的文本与技能恢复语义。
    replace(parts);
    focus();
  };
}
