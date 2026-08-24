import type { AgentSkill, ProjectFileSearchEntry } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import {
  appendPromptFileReference,
  createPromptSkillContent,
  insertPromptFileReference,
  insertPromptSkill,
  removePromptFileReference,
  serializePromptSkillContent,
  toPromptSkillSubmission,
} from "./prompt-skill-content.js";

const skill: AgentSkill = {
  description: "审查认证边界",
  displayName: "Security review",
  id: "skill-security",
  name: "review-security",
  scope: "system",
};

const sourceFile: ProjectFileSearchEntry = {
  name: "main.tsx",
  path: "src/main.tsx",
  rootId: "root-primary",
  rootPath: "/workspace/primary",
};
const testFile: ProjectFileSearchEntry = {
  name: "main.test.tsx",
  path: "src/main.test.tsx",
  rootId: "root-primary",
  rootPath: "/workspace/primary",
};

describe("prompt file reference content", () => {
  it("appends a unique file or directory reference after existing draft text", () => {
    const withFile = appendPromptFileReference(createPromptSkillContent("Review this"), sourceFile);
    const withDirectory = appendPromptFileReference(withFile, {
      name: "components",
      path: "src/components",
      rootId: "root-primary",
      rootPath: "/workspace/primary",
    });

    expect(serializePromptSkillContent(withDirectory)).toBe(
      "Review this @/workspace/primary/src/main.tsx @/workspace/primary/src/components",
    );
    expect(appendPromptFileReference(withDirectory, sourceFile)).toBe(withDirectory);
  });

  it("replaces mention ranges while preserving text and Skill token order", () => {
    const withSkill = insertPromptSkill(
      createPromptSkillContent("/security 请检查 @main 后续"),
      { end: 9, start: 0 },
      skill,
    );
    const withFile = insertPromptFileReference(withSkill, { end: 26, start: 21 }, sourceFile);

    expect(serializePromptSkillContent(withFile)).toBe(
      "$review-security 请检查 @/workspace/primary/src/main.tsx 后续",
    );
    expect(toPromptSkillSubmission(withFile)).toEqual({
      skills: [skill],
      text: "请检查 @/workspace/primary/src/main.tsx 后续",
    });
  });

  it("keeps adjacent text outside a submitted file reference", () => {
    const gitignoreFile: ProjectFileSearchEntry = {
      name: ".gitignore",
      path: ".gitignore",
      rootId: "root-primary",
      rootPath: "/workspace/primary",
    };

    expect(
      toPromptSkillSubmission([
        { file: gitignoreFile, type: "file" },
        { text: "读取文件", type: "text" },
      ]),
    ).toEqual({
      skills: [],
      text: "@/workspace/primary/.gitignore 读取文件",
    });
  });

  it("serializes Windows roots with native separators", () => {
    expect(
      serializePromptSkillContent([
        {
          file: {
            name: "main.tsx",
            path: "src/main.tsx",
            rootId: "root-windows",
            rootPath: "C:\\workspace\\Codexly",
          },
          type: "file",
        },
      ]),
    ).toBe("@C:\\workspace\\Codexly\\src\\main.tsx");
  });

  it("deduplicates by root identity and removes only the requested file token", () => {
    const once = appendPromptFileReference(createPromptSkillContent("对比 "), sourceFile);
    const duplicate = appendPromptFileReference(once, sourceFile);
    const withTest = appendPromptFileReference(duplicate, testFile);
    const secondaryFile = {
      ...sourceFile,
      rootId: "root-secondary",
      rootPath: "/workspace/secondary",
    };
    const withSecondary = appendPromptFileReference(withTest, secondaryFile);

    expect(serializePromptSkillContent(duplicate)).toBe("对比 @/workspace/primary/src/main.tsx");
    expect(serializePromptSkillContent(withSecondary)).toContain(
      "@/workspace/secondary/src/main.tsx",
    );
    const afterPrimaryRemoval = serializePromptSkillContent(
      removePromptFileReference(withSecondary, sourceFile),
    );
    expect(afterPrimaryRemoval).not.toContain("@/workspace/primary/src/main.tsx");
    expect(afterPrimaryRemoval).toContain("@/workspace/primary/src/main.test.tsx");
    expect(afterPrimaryRemoval).toContain("@/workspace/secondary/src/main.tsx");
  });
});
