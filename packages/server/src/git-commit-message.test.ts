import type { GenerateCommitMessageRequest, ProjectGitStatus } from "@code-agent/protocol";
import { describe, expect, it } from "vitest";

import { buildCommitMessagePrompt } from "./git-commit-message.js";

const status: ProjectGitStatus = {
  baseBranches: ["main"],
  branch: "feat/commit-message",
  branches: ["feat/commit-message", "main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [
    {
      diff: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
      kind: "update",
      path: "src/app.ts",
    },
  ],
};

const request: GenerateCommitMessageRequest = {
  expectedSnapshot: status.snapshot,
  paths: ["src/app.ts"],
};

describe("buildCommitMessagePrompt", () => {
  it("does not impose commit style when no user preference is configured", () => {
    const prompt = buildCommitMessagePrompt(status, request, "");

    expect(prompt).not.toContain("imperative mood");
    expect(prompt).not.toContain("subject");
    expect(prompt).not.toContain("body");
    expect(prompt).not.toContain("format and language");
  });

  it("preserves configured commit preferences verbatim", () => {
    const preference = "使用详细正文，并说明每项变更的影响。";

    expect(buildCommitMessagePrompt(status, request, preference)).toContain(
      `<user-preferences>\n${preference}\n</user-preferences>`,
    );
  });
});
