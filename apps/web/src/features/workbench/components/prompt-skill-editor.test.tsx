import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSkill } from "@codexly/protocol";

import {
  createPromptSkillContent,
  insertPromptSkill,
  PromptSkillEditor,
  recognizePromptSkillReferences,
  removePromptSlashCommand,
  serializePromptSkillContent,
  toPromptSkillSubmission,
} from "./prompt-skill-editor.js";

const securitySkill: AgentSkill = {
  description: "审查认证边界",
  displayName: "Security review",
  id: "skill-security",
  name: "review-security",
  scope: "system",
};

const documentationSkill: AgentSkill = {
  description: "编写项目文档",
  displayName: "Documentation writer",
  id: "skill-docs",
  name: "documentation-writer",
  scope: "user",
};

describe("prompt skill editor model", () => {
  it("renders the empty-state copy with a lighter placeholder color", () => {
    const markup = renderToStaticMarkup(
      <PromptSkillEditor
        content={[]}
        onChange={() => undefined}
        placeholder="告诉 Codexly 你想完成什么"
        skills={[securitySkill, documentationSkill]}
        scope="project-1:new"
      />,
    );

    expect(markup).toContain('placeholder="告诉 Codexly 你想完成什么"');
    expect(markup).toContain("placeholder:text-muted-foreground/60");
    expect(markup).toContain("<textarea");
  });

  it("renders selected references as plain textarea text", () => {
    const markup = renderToStaticMarkup(
      <PromptSkillEditor
        content={[
          { skill: securitySkill, type: "skill" },
          { text: " ", type: "text" },
          {
            file: {
              name: "main.tsx",
              path: "src/main.tsx",
              rootId: "primary",
              rootPath: "/workspace",
            },
            type: "file",
          },
        ]}
        onChange={() => undefined}
        placeholder="任务输入"
        skills={[securitySkill]}
        scope="project-1:new"
      />,
    );

    expect(markup).toContain("$review-security @/workspace/src/main.tsx</textarea>");
    expect(markup).not.toContain("data-prompt-skill-id");
    expect(markup).not.toContain("data-prompt-file-path");
  });

  it("inserts multiple skills at slash ranges while preserving inline order", () => {
    const initial = createPromptSkillContent("/security 之后 /docs");
    const withSecurity = insertPromptSkill(initial, { end: 9, start: 0 }, securitySkill);
    const withBoth = insertPromptSkill(withSecurity, { end: 25, start: 20 }, documentationSkill);

    expect(serializePromptSkillContent(withBoth)).toBe(
      "$review-security 之后 $documentation-writer",
    );
    expect(toPromptSkillSubmission(withBoth)).toEqual({
      skills: [securitySkill, documentationSkill],
      text: "之后",
    });
  });

  it("recognizes typed Codex skill references and removes them from submission text", () => {
    const recognized = recognizePromptSkillReferences(
      createPromptSkillContent("$review-security 其他需求"),
      [securitySkill, documentationSkill],
    );

    expect(serializePromptSkillContent(recognized)).toBe("$review-security 其他需求");
    expect(toPromptSkillSubmission(recognized)).toEqual({
      skills: [securitySkill],
      text: "其他需求",
    });
    expect(
      recognizePromptSkillReferences(createPromptSkillContent("前缀$review-security $unknown"), [
        securitySkill,
      ]),
    ).toEqual(createPromptSkillContent("前缀$review-security $unknown"));
  });

  it("treats partially edited references as text while retaining intact skills", () => {
    const visibleText = "$review-secur 修复 @/workspace/src/main.t 继续 $documentation-writer";
    const content = recognizePromptSkillReferences(createPromptSkillContent(visibleText), [
      securitySkill,
      documentationSkill,
    ]);

    expect(serializePromptSkillContent(content)).toBe(visibleText);
    expect(toPromptSkillSubmission(content)).toEqual({
      skills: [documentationSkill],
      text: "$review-secur 修复 @/workspace/src/main.t 继续",
    });
  });

  it("deduplicates selected skills and keeps typed references editable", () => {
    const initial = createPromptSkillContent("/security 说明 /security");
    const once = insertPromptSkill(initial, { end: 9, start: 0 }, securitySkill);
    const duplicate = insertPromptSkill(once, { end: 29, start: 20 }, securitySkill);
    expect(serializePromptSkillContent(duplicate)).toBe("$review-security 说明 ");
    const typed = recognizePromptSkillReferences(
      createPromptSkillContent("$review-security $review-security $documentation-writer"),
      [securitySkill, documentationSkill],
    );
    expect(serializePromptSkillContent(typed)).toBe(
      "$review-security $review-security $documentation-writer",
    );
    expect(toPromptSkillSubmission(typed).skills).toEqual([securitySkill, documentationSkill]);
  });

  it("removes only the selected Slash command while preserving Skill tokens", () => {
    const initial = insertPromptSkill(
      createPromptSkillContent("保留 /security 后执行 /plan 尾部"),
      { end: 12, start: 3 },
      securitySkill,
    );

    expect(
      serializePromptSkillContent(removePromptSlashCommand(initial, { end: 29, start: 23 })),
    ).toBe("保留 $review-security 后执行 尾部");
  });
});
