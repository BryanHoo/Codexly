import { describe, expect, it, vi } from "vitest";

import type {
  AgentProvider,
  AgentProviderConnectionRepository,
  AgentRuntimeProvider,
} from "@codexly/core";
import type {
  AgentModelPage,
  AgentProviderConnectionRecord,
  AgentTaskSettings,
  AgentTurn,
} from "@codexly/protocol";

import { createModelCatalogLoader, generateCommitMessageWithCodex } from "./server-runtime.js";
import { createProvider } from "./app-provider.test-support.js";
import { task } from "./app.test-support.js";

describe("generateCommitMessageWithCodex", () => {
  const settings: AgentTaskSettings = {
    model: "test-model",
    reasoningEffort: "",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxMode: "read-only",
  };
  const runningTurn: AgentTurn = {
    completedAt: null,
    error: null,
    id: "commit-turn",
    items: [],
    status: "running",
    startedAt: "2026-11-02T00:00:00Z",
  };
  const completedTurn: AgentTurn = {
    ...runningTurn,
    status: "completed",
    items: [
      {
        id: "message",
        type: "message",
        role: "assistant",
        text: '{"message":"fix(git): 修复提交说明生成"}',
      },
    ],
  };
  function setup() {
    const harness = createProvider();
    const start = Promise.withResolvers<AgentTurn>();
    const startTurn = vi.fn<AgentProvider["startTurn"]>(() => start.promise);
    harness.provider.startTurn = startTurn;
    const emitError = () => {
      harness.emitEvent({
        type: "provider.error",
        taskId: task.id,
        turnId: runningTurn.id,
        payload: { message: "provider failed", willRetry: false },
      });
    };
    return { ...harness, start, startTurn, emitError };
  }

  it("handles provider failure before a later RPC rejection without unhandled rejections", async () => {
    const harness = setup();
    const result = generateCommitMessageWithCodex(harness.provider, "prompt", settings);
    const check = expect(result).rejects.toThrow("provider failed");
    await vi.waitFor(() => {
      expect(harness.startTurn).toHaveBeenCalled();
    });
    harness.emitError();
    // 跨过一个真实事件循环轮次，确保旧实现中无人接管的拒绝会被 Node/Vitest 检测到。
    await new Promise<void>((resolve) => setImmediate(resolve));
    harness.start.reject(new Error("start RPC failed"));
    await check;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(harness.eventListeners.size).toBe(0);
    expect(harness.unsubscribeTask).toHaveBeenCalledExactlyOnceWith(task.id);
  });

  it.each(["resolve", "reject"] as const)(
    "times out a pending start RPC and handles its late %s",
    async (outcome) => {
      vi.useFakeTimers();
      const harness = setup();
      try {
        const result = generateCommitMessageWithCodex(harness.provider, "prompt", settings);
        const check = expect(result).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(55_000);
        expect(harness.unsubscribeTask).toHaveBeenCalledExactlyOnceWith(task.id);
        await check;
        expect(harness.eventListeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        if (outcome === "resolve") harness.start.resolve(runningTurn);
        else harness.start.reject(new Error("late RPC failure"));
        await vi.advanceTimersByTimeAsync(0);
        expect(harness.interruptTurn).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
        if (outcome === "resolve")
          expect(harness.interruptTurn).toHaveBeenCalledWith(task.id, runningTurn.id);
        expect(harness.unsubscribeTask).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("accepts a terminal start response without a completion event", async () => {
    const harness = setup();
    harness.start.resolve(completedTurn);
    await expect(
      generateCommitMessageWithCodex(harness.provider, "prompt", settings),
    ).resolves.toBe("fix(git): 修复提交说明生成");
    expect(harness.eventListeners.size).toBe(0);
    expect(harness.interruptTurn).not.toHaveBeenCalled();
  });

  it("uses an early completion event and handles a later RPC rejection", async () => {
    const harness = setup();
    const result = generateCommitMessageWithCodex(harness.provider, "prompt", settings);
    await vi.waitFor(() => {
      expect(harness.startTurn).toHaveBeenCalled();
    });
    harness.emitEvent({
      type: "turn.completed",
      taskId: task.id,
      turnId: completedTurn.id,
      payload: { turn: completedTurn },
    });
    await expect(result).resolves.toBe("fix(git): 修复提交说明生成");
    harness.start.reject(new Error("late RPC failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(harness.eventListeners.size).toBe(0);
    expect(harness.interruptTurn).not.toHaveBeenCalled();
    expect(harness.unsubscribeTask).toHaveBeenCalledOnce();
  });

  it("cleans up a running turn when completion times out and ignores cleanup failures", async () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.start.resolve(runningTurn);
    harness.interruptTurn.mockRejectedValue(new Error("interrupt failed"));
    harness.unsubscribeTask.mockRejectedValue(new Error("unsubscribe failed"));
    try {
      const result = generateCommitMessageWithCodex(harness.provider, "prompt", settings);
      const check = expect(result).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(55_000);
      await check;
      expect(harness.interruptTurn).toHaveBeenCalledExactlyOnceWith(task.id, runningTurn.id);
      expect(harness.unsubscribeTask).toHaveBeenCalledExactlyOnceWith(task.id);
      expect(harness.eventListeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up when the start RPC throws synchronously", async () => {
    const harness = setup();
    harness.provider.startTurn = () => {
      throw new Error("sync start failed");
    };
    await expect(
      generateCommitMessageWithCodex(harness.provider, "prompt", settings),
    ).rejects.toThrow("sync start failed");
    expect(harness.eventListeners.size).toBe(0);
    expect(harness.unsubscribeTask).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "reject"] as const)(
    "retries a busy task release after the late RPC %s",
    async (outcome) => {
      vi.useFakeTimers();
      const harness = setup();
      const unsubscribe = vi
        .fn<AgentProvider["unsubscribeTask"]>()
        .mockResolvedValueOnce("busy")
        .mockResolvedValue("unsubscribed");
      harness.provider.unsubscribeTask = unsubscribe;
      try {
        const result = generateCommitMessageWithCodex(harness.provider, "prompt", settings);
        const check = expect(result).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(55_000);
        await check;
        expect(unsubscribe).toHaveBeenCalledOnce();
        if (outcome === "resolve") harness.start.resolve(runningTurn);
        else harness.start.reject(new Error("late RPC failure"));
        await vi.advanceTimersByTimeAsync(0);
        expect(unsubscribe).toHaveBeenCalledTimes(2);
        expect(harness.eventListeners.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("createModelCatalogLoader", () => {
  it("uses the active Codex CLI provider catalog instead of stale app-managed models", async () => {
    const cliModels: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "cli-model",
          id: "cli-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const provider = {
      listModels: vi.fn(() => Promise.resolve(cliModels)),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://cli.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://old.example.test/v1",
          customModels: { data: [], nextCursor: null },
          mode: "custom" as const,
          updatedAt: "2026-08-07T00:00:00.000Z",
        }),
      ),
      writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    } satisfies Pick<
      AgentProviderConnectionRepository,
      "readProviderConnection" | "writeProviderConnection"
    >;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual(cliModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
    expect(repository.writeProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customBaseUrl: "https://cli.example.test/v1", mode: "custom" }),
    );
  });

  it("refreshes the online catalog before using a matching persisted catalog", async () => {
    const runtimeModels: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "low",
          description: "Latest model",
          displayName: "GPT-6-Astra",
          id: "gpt-6-astra",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "Fast", id: "low" }],
        },
        {
          defaultReasoningEffort: "medium",
          description: "Updated model metadata",
          displayName: "GPT-5.6-Sol",
          id: "gpt-5.6-sol",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "Balanced", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const persistedModels = {
      data: [
        {
          defaultReasoningEffort: "low",
          description: "Stale model metadata",
          displayName: "GPT-5.6 Sol",
          id: "gpt-5.6-sol",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "Fast", id: "low" }],
        },
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "Manual Model",
          id: "manual-model",
          isDefault: false,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    } satisfies NonNullable<AgentProviderConnectionRecord["customModels"]>;
    const provider = {
      listModels: vi.fn(() => Promise.resolve(runtimeModels)),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://api.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://api.example.test/v1",
          customModels: persistedModels,
          mode: "custom" as const,
          updatedAt: "2026-09-14T00:00:00.000Z",
        }),
      ),
      writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    } satisfies Pick<
      AgentProviderConnectionRepository,
      "readProviderConnection" | "writeProviderConnection"
    >;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual(runtimeModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
    expect(repository.writeProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customModels: runtimeModels, mode: "custom" }),
    );
  });

  it("uses the Codex CLI catalog when no persisted custom catalog is available", async () => {
    const cliModels: AgentModelPage = {
      data: [
        {
          defaultReasoningEffort: "medium",
          description: "",
          displayName: "CLI Model",
          id: "cli-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "", id: "medium" }],
        },
      ],
      nextCursor: null,
    };
    const provider = {
      listModels: vi.fn(() => Promise.resolve(cliModels)),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "apiKey" as const },
          customBaseUrl: "https://api.example.test/v1",
          mode: "custom" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: "https://api.example.test/v1",
          customModels: null,
          mode: "custom" as const,
          updatedAt: "2026-09-14T00:00:00.000Z",
        }),
      ),
      writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    } satisfies Pick<
      AgentProviderConnectionRepository,
      "readProviderConnection" | "writeProviderConnection"
    >;

    const load = createModelCatalogLoader(provider, repository);

    await expect(load()).resolves.toEqual(cliModels);
    expect(provider.listModels).toHaveBeenCalledOnce();
  });

  it("propagates catalog failures without restoring a persisted catalog", async () => {
    const persistedModels = {
      data: [
        {
          defaultReasoningEffort: "high",
          description: "Cached metadata",
          displayName: "Cached Model",
          id: "cached-model",
          isDefault: true,
          supportedReasoningEfforts: [{ description: "Deep", id: "high" }],
        },
      ],
      nextCursor: null,
    } satisfies NonNullable<AgentProviderConnectionRecord["customModels"]>;
    const provider = {
      listModels: vi.fn(() => Promise.reject(new Error("catalog unavailable"))),
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          account: { type: "chatgpt" as const, email: null, planType: "pro" },
          customBaseUrl: null,
          mode: "official" as const,
          pendingLogin: null,
          state: "connected" as const,
        }),
      ),
    } satisfies Pick<AgentRuntimeProvider, "listModels" | "readProviderConnection">;
    const repository = {
      readProviderConnection: vi.fn(() =>
        Promise.resolve({
          customBaseUrl: null,
          customModels: persistedModels,
          mode: "official" as const,
          updatedAt: "2026-09-23T00:00:00.000Z",
        }),
      ),
      writeProviderConnection: vi.fn((record) => Promise.resolve(record)),
    } satisfies Pick<
      AgentProviderConnectionRepository,
      "readProviderConnection" | "writeProviderConnection"
    >;

    await expect(createModelCatalogLoader(provider, repository)()).rejects.toThrow(
      "catalog unavailable",
    );
    expect(repository.readProviderConnection).not.toHaveBeenCalled();
    expect(repository.writeProviderConnection).not.toHaveBeenCalled();
  });
});
