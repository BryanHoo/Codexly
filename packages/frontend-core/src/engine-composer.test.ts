import { describe, expect, it } from "vitest";
import {
  resolveComposerEngine,
  resolveClaudeComposerSettings,
  resolveCodexComposerSettings,
} from "./engine-composer.js";

describe("shared composer engine policy", () => {
  it("only lets empty drafts select engines and keeps legacy history on Codex", () => {
    expect(resolveComposerEngine(undefined, undefined, "claude")).toBe("claude");
    expect(resolveComposerEngine("history", {}, "claude")).toBe("codex");
    expect(resolveComposerEngine("history", { engine: "claude" }, "codex")).toBe("claude");
  });
  it("仅配置一个引擎时覆盖草稿中失效的历史选择", () => {
    expect(
      resolveComposerEngine(undefined, undefined, "claude", { codex: true, claude: false }),
    ).toBe("codex");
    expect(
      resolveComposerEngine(undefined, undefined, "codex", { codex: false, claude: true }),
    ).toBe("claude");
  });
  it("双引擎已配置时保留草稿选择，均未配置时回落 Codex", () => {
    expect(
      resolveComposerEngine(undefined, undefined, "claude", { codex: true, claude: true }),
    ).toBe("claude");
    expect(
      resolveComposerEngine(undefined, undefined, "codex", { codex: true, claude: true }),
    ).toBe("codex");
    expect(
      resolveComposerEngine(undefined, undefined, "claude", { codex: false, claude: false }),
    ).toBe("codex");
  });
  it("配置变化不得改写已有会话的引擎", () => {
    expect(
      resolveComposerEngine("history", { engine: "claude" }, "codex", {
        codex: true,
        claude: false,
      }),
    ).toBe("claude");
    expect(resolveComposerEngine("history", {}, "claude", { codex: false, claude: true })).toBe(
      "codex",
    );
  });
  it("never inherits Codex model or permission defaults into Claude", () => {
    const settings = resolveClaudeComposerSettings(
      {
        model: "gpt",
        reasoningEffort: "high",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        sandboxMode: "danger-full-access",
      },
      [
        {
          id: "sonnet",
          displayName: "Sonnet",
          isDefault: true,
          description: "",
          defaultReasoningEffort: "",
          supportedReasoningEfforts: [],
        },
      ],
    );
    expect(settings).toMatchObject({
      model: "sonnet",
      reasoningEffort: "",
      approvalsReviewer: "user",
      engineOptions: { engine: "claude", permissionMode: "default" },
    });
    expect(
      resolveClaudeComposerSettings(
        { ...settings, engineOptions: { engine: "claude", permissionMode: "plan" } },
        [],
      ),
    ).toMatchObject({ model: "sonnet", engineOptions: { permissionMode: "plan" } });
  });
});

it("保留已保存计划的引擎，不随当前配置自动改写", () => {
  expect(
    resolveComposerEngine(undefined, undefined, "claude", { codex: true, claude: false }, true),
  ).toBe("claude");
  expect(
    resolveComposerEngine(undefined, undefined, "codex", { codex: false, claude: true }, true),
  ).toBe("codex");
});
it("从 Claude 切回 Codex 时清除引擎选项并选择 Codex 模型", () => {
  const result = resolveCodexComposerSettings(
    {
      model: "sonnet",
      reasoningEffort: "",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxMode: "workspace-write",
      engineOptions: { engine: "claude", permissionMode: "plan" },
    },
    [
      {
        id: "gpt",
        displayName: "GPT",
        description: "",
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [{ id: "high", description: "" }],
      },
    ],
  );
  expect(result).toMatchObject({ model: "gpt", reasoningEffort: "high" });
  expect(result.engineOptions).toBeUndefined();
  expect(resolveCodexComposerSettings(result, [])).toBe(result);
});
