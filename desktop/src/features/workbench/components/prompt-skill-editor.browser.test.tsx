import type { AgentSkill, ProjectFileSearchEntry } from "@/protocol/index.js";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PromptInput } from "../../../shared/components/agent/prompt-input.js";
import { PromptSkillEditor, type PromptSkillEditorHandle } from "./prompt-skill-editor.js";
import {
  insertPromptFileReference,
  insertPromptSkill,
  toPromptSkillSubmission,
} from "./prompt-skill-content.js";
import { createRef } from "react";

const skill = { id: "/skills/review/SKILL.md", name: "review", displayName: "Review" } as AgentSkill;
const file = {
  name: "main.ts", path: "src/main.ts", rootId: "root", rootPath: "/project",
} as ProjectFileSearchEntry;

it("用纯文本编辑 skill 和文件引用，并同步提交内容", async () => {
  const ref = createRef<PromptSkillEditorHandle>();
  const onChange = vi.fn();
  const screen = await render(
    <PromptSkillEditor
      content={[{ skill, type: "skill" }, { text: " ", type: "text" }, { file, type: "file" }]}
      onChange={onChange}
      placeholder="输入"
      ref={ref}
      scope="test"
      skills={[skill]}
    />,
  );
  const input = screen.container.querySelector("textarea")!;
  expect(input.value).toBe("$review @/project/src/main.ts");
  expect(screen.container.querySelector("[contenteditable], [data-prompt-skill-id], [data-prompt-file-path]")).toBeNull();

  await screen.getByRole("textbox").fill("@/project/src/main.ts changed");
  expect(toPromptSkillSubmission(ref.current!.getContent())).toEqual({
    skills: [], text: "@/project/src/main.ts changed",
  });
  expect(onChange).toHaveBeenCalled();
});

it.each([
  {
    initial: "/review 修复另一个问题",
    partial: "$rev 修复另一个问题",
    select: (text: string) => insertPromptSkill(
      [{ text, type: "text" }], { start: 0, end: 7 }, skill,
    ),
  },
  {
    initial: "检查 @ma 并继续",
    partial: "检查 @/project/src/mai 并继续",
    select: (text: string) => insertPromptFileReference(
      [{ text, type: "text" }], { start: 3, end: 6 }, file,
    ),
  },
])("选择引用后删除一半再发送：$initial", async ({ initial, partial, select }) => {
  const ref = createRef<PromptSkillEditorHandle>();
  const submitted = vi.fn();
  const screen = await render(
    <PromptInput onSubmit={(message) => {
      submitted({ message, snapshot: toPromptSkillSubmission(ref.current!.getContent()) });
    }}>
      <PromptSkillEditor
        content={[{ text: initial, type: "text" }]}
        onChange={() => undefined}
        placeholder="输入"
        ref={ref}
        scope="test"
        skills={[skill]}
      />
      <button type="submit">发送</button>
    </PromptInput>,
  );
  ref.current!.replace(select(initial));
  await screen.getByRole("textbox").fill(partial);
  await screen.getByRole("button", { name: "发送" }).click();
  expect(submitted).toHaveBeenCalledExactlyOnceWith({
    message: { files: [], text: partial },
    snapshot: { skills: [], text: partial },
  });
});
