import type { PromptDocumentPart } from "@codexly/protocol";

export function createFollowupDraftAction({
  disabled,
  read,
  replace,
  focus,
}: Readonly<{
  disabled: boolean;
  read: () => readonly PromptDocumentPart[];
  replace: (content: readonly PromptDocumentPart[]) => void;
  focus: () => void;
}>): (prompt: string) => void {
  return (prompt) => {
    if (disabled || prompt.trim() === "") return;
    const content = read();
    const hasContent = content.some((part) => part.type !== "text" || part.text !== "");
    // 建议追加到现有草稿，保留 Skill、文件引用和调用方持有的附件；实际提交仍由发送按钮负责。
    replace([...content, { type: "text", text: `${hasContent ? "\n\n" : ""}${prompt}` }]);
    focus();
  };
}
