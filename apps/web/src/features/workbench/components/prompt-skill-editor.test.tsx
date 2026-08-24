import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSkill } from "@codexly/protocol";

import {
  createPromptSkillContent,
  insertPromptSkill,
  PromptSkillEditor,
  recognizePromptSkillReferences,
  removePromptSlashCommand,
  removePromptSkill,
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

    expect(markup).toContain('data-placeholder="告诉 Codexly 你想完成什么"');
    expect(markup).toContain("before:text-muted-foreground/60");
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

  it("deduplicates the same skill and removes only the selected token", () => {
    const initial = createPromptSkillContent("/security 说明 /security");
    const once = insertPromptSkill(initial, { end: 9, start: 0 }, securitySkill);
    const duplicate = insertPromptSkill(once, { end: 29, start: 20 }, securitySkill);
    const withDocumentation = insertPromptSkill(
      duplicate,
      { end: 20, start: 20 },
      documentationSkill,
    );

    expect(serializePromptSkillContent(duplicate)).toBe("$review-security 说明 ");
    expect(
      serializePromptSkillContent(removePromptSkill(withDocumentation, securitySkill.id)),
    ).toBe(" 说明 $documentation-writer");
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
