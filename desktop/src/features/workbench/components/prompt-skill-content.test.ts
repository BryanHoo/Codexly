import { getProjectTargetAbsolutePath } from "./project-open-menu-model.js";
import { fileReferencePlainText as referenceText } from "./prompt-skill-content.js";
import type { AgentSkill, ProjectFileSearchEntry } from "@/protocol/index.js";
import { describe, expect, it } from "vitest";

import {
  createPromptSkillContentFromSubmission,
  fileReferencePlainText,
  parsePromptReferenceText,
  serializePromptSkillContent,
  toPromptSkillSubmission,
} from "./prompt-skill-content.js";

const skill = { id: "/skills/review/SKILL.md", name: "review" } as AgentSkill;
const file = {
  name: "main.ts",
  path: "src/main.ts",
  rootId: "root",
  rootPath: "/project",
} as ProjectFileSearchEntry;

describe("Codex 引用提交", () => {
  it("同时提交可见的 $skill 正文和结构化 skill，文件保持 @path 文本", () => {
    const content = [
      { skill, type: "skill" as const },
      { text: " 检查 ", type: "text" as const },
      { file, type: "file" as const },
    ];
    expect(toPromptSkillSubmission(content)).toEqual({
      skills: [skill],
      text: `$review 检查 ${fileReferencePlainText(file)}`,
    });
    expect(toPromptSkillSubmission(content).text).toBe(serializePromptSkillContent(content));
  });

  it("从队列恢复时不重复插入已在正文中的 $skill", () => {
    const text = "$review 检查代码";
    const content = createPromptSkillContentFromSubmission(text, [skill]);
    expect(serializePromptSkillContent(content)).toBe(text);
    expect(toPromptSkillSubmission(content)).toEqual({ skills: [skill], text });
  });

  it("标点紧邻 $skill 时仍保留结构化引用", () => {
    const content = parsePromptReferenceText("请 $review, 然后提交", [], [skill]);
    expect(toPromptSkillSubmission(content)).toEqual({
      skills: [skill],
      text: "请 $review, 然后提交",
    });
  });
});

// 同一宿主路径必须在菜单与输入框引用中保持一致，不受浏览器系统影响。
it.each([
  ["/srv/project\\", "docs/a.txt", "/srv/project\\/docs/a.txt"],
  ["/srv/project", "docs/a\\b.txt", "/srv/project/docs/a\\b.txt"],
  ["C:\\work/project", "docs/a.txt", "C:\\work/project\\docs\\a.txt"],
])("保留宿主根目录 %s 的原始语义", (rootPath, path, expected) => {
  expect(getProjectTargetAbsolutePath(rootPath, path)).toBe(expected);
  expect(referenceText({ rootPath, path })).toBe(`@${expected}`);
});
