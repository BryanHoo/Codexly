import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createServerOptions,
} from "./app-all.test-support.js";

describe("prompt optimization", () => {
  it.each(["", "保留原文语言，明确验收条件"])(
    "uses auxiliary defaults and configured instructions: %s",
    async (instructions) => {
      const { provider } = createProvider();
      const settings = createSettingsRepository();
      settings.readGlobalSettings.mockResolvedValue({
        defaultAgent: "claude",
        defaultModel: "haiku",
        promptOptimizationPrompt: instructions,
      } as never);
      const generateCommitMessage = vi.fn().mockResolvedValue("优化后的提示词");
      const options = createServerOptions(provider, { settingsRepository: settings.repository });
      options.provider = {
        ...options.provider,
        engines: { claude: { generateCommitMessage } } as never,
      };
      const app = await createCodexlyServer(options);
      closeCallbacks.push(() => app.close());
      const response = await app.inject({
        method: "POST",
        url: "/v1/projects/codexly/prompt-optimization",
        headers: { "idempotency-key": "optimize-1" },
        payload: { text: "修复登录" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ text: "优化后的提示词" });
      expect(generateCommitMessage).toHaveBeenCalledWith(
        expect.stringContaining(instructions || "保留用户的原始意图"),
        "haiku",
        expect.stringContaining("Do not call tools"),
      );
      const invalid = await app.inject({
        method: "POST",
        url: "/v1/projects/codexly/prompt-optimization",
        headers: { "idempotency-key": "optimize-2" },
        payload: { text: " " },
      });
      expect(invalid.statusCode).toBe(400);
      expect(generateCommitMessage).toHaveBeenCalledTimes(1);
    },
  );
});

it("uses a private Codex generation with the auxiliary model and releases it", async () => {
  const { provider, startTask, startTurn, unsubscribeTask } = createProvider();
  startTurn.mockImplementation(() =>
    Promise.resolve({
      id: "optimization-turn",
      status: "completed",
      startedAt: "2026-11-03T00:00:00.000Z",
      completedAt: "2026-11-03T00:00:01.000Z",
      error: null,
      items: [
        {
          id: "optimized",
          type: "message",
          role: "assistant",
          text: JSON.stringify({ message: "修复登录并添加回归验证" }),
        },
      ],
    }),
  );
  const settings = createSettingsRepository();
  settings.readGlobalSettings.mockResolvedValue({
    defaultAgent: "codex",
    defaultModel: "configured-model",
  } as never);
  const app = await createCodexlyServer(
    createServerOptions(provider, { settingsRepository: settings.repository }),
  );
  closeCallbacks.push(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/v1/projects/codexly/prompt-optimization",
    headers: { "idempotency-key": "codex-optimize" },
    payload: { text: "修复登录" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ text: "修复登录并添加回归验证" });
  expect(startTask).toHaveBeenCalledWith({ ephemeral: true });
  expect(startTurn.mock.calls[0]?.[1].text).toContain("Do not call tools");
  expect(startTurn.mock.calls[0]?.[2]).toMatchObject({
    model: "configured-model",
    sandboxMode: "read-only",
    approvalPolicy: "never",
  });
  expect(unsubscribeTask).toHaveBeenCalledOnce();
});
