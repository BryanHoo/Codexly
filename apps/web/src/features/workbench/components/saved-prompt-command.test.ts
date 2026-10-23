import { expect, it, vi } from "vitest";
import { getSavedPromptCommands } from "@codexly/frontend-core/saved-prompts";
import { createComposerCommands } from "./workbench-composer-commands.js";
import { serializePromptSkillContent, type PromptSkillContent } from "./prompt-skill-content.js";

it.each(["/", "#"])(
  "inserts saved text in a running composer without submitting or losing references",
  async (trigger) => {
    const file = {
      type: "file",
      file: { name: "main.ts", path: "main.ts", rootId: "root", rootPath: "/project" },
    } as const;
    const content: PromptSkillContent = [file, { type: "text", text: ` 前文 ${trigger}检查 后文` }];
    const text = serializePromptSkillContent(content);
    const start = text.indexOf(`${trigger}检查`);
    const replacePromptContent = vi.fn<(content: PromptSkillContent, offset?: number) => void>();
    const focus = vi.fn();
    const closeCommandMenu = vi.fn();
    const submitPrompt = vi.fn();
    const command = getSavedPromptCommands([
      { id: "check", name: "检查", content: "检查实现。\n补充测试。" },
    ])[0];
    if (!command) throw new Error("Missing saved prompt command");
    type Options = Parameters<typeof createComposerCommands>[0];
    const options = {
      session: {
        composerController: {},
        promptContent: content,
        state: "running",
        commandSlashCommand: { start, end: start + 3, query: "检查" },
        replacePromptContent,
        closeCommandMenu,
        skillEditorRef: { current: { getContent: () => content, focus } },
      },
      capabilities: undefined,
      submitPrompt,
      t: (key: string) => key,
    } as unknown as Options;
    await createComposerCommands(options).executePromptCommand(command);
    const call = replacePromptContent.mock.calls[0];
    if (!call) throw new Error("Saved prompt was not inserted");
    const [inserted, offset] = call;
    expect(inserted[0]).toBe(file);
    expect(serializePromptSkillContent(inserted)).toBe(
      "@/project/main.ts 前文 检查实现。\n补充测试。 后文",
    );
    expect(offset).toBe(start + command.content.length);
    expect(focus).toHaveBeenCalledWith(offset);
    expect(closeCommandMenu).toHaveBeenCalledOnce();
    expect(submitPrompt).not.toHaveBeenCalled();
  },
);
