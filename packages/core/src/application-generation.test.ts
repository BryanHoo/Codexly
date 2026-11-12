import { expect, it, vi } from "vitest";
import * as core from "./index.js";
const preferences = core.applicationPreferencesFromLegacy({
  defaultAgent: "claude",
  defaultModel: null,
  taskTitlePrompt: "标题规则",
  commitMessagePrompt: "提交规则",
  promptOptimizationPrompt: "优化规则",
});
it("三类生成只使用选定 ACP 引擎和私有偏好，null 不发送模型覆盖", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce('{"title":"修复登录"}')
    .mockResolvedValueOnce('{"message":"feat: 修复登录"}')
    .mockResolvedValueOnce('{"message":"优化后的输入"}');
  const signal = new AbortController().signal;
  for (const [purpose, expected] of [
    ["title", "修复登录"],
    ["commit", "feat: 修复登录"],
    ["optimize", "优化后的输入"],
  ] as const) {
    expect(
      await core.generateApplicationText(
        preferences,
        "/workspace",
        { purpose, text: "原始正文" },
        signal,
        generate,
      ),
    ).toBe(expected);
  }
  for (const call of generate.mock.calls) {
    expect(call[0]).toBe("claude");
    expect(call[1]).toBe("/workspace");
    expect(call[3]).toBeUndefined();
  }
  expect(generate.mock.calls[0]?.[2]).toContain("标题规则");
  expect(generate.mock.calls[1]?.[2]).toContain("提交规则");
  expect(generate.mock.calls[2]?.[2]).toContain("优化规则");
});
it("保留原始模型标识，错误或超限输出明确失败，不写入任务目录", async () => {
  const generate = vi.fn().mockResolvedValue('{"message":"结果"}');
  const signal = new AbortController().signal;
  await core.generateApplicationText(
    { ...preferences, defaultModel: "provider/raw/model" },
    "/workspace",
    { purpose: "commit", text: "diff" },
    signal,
    generate,
  );
  expect(generate.mock.calls[0]?.[3]).toBe("provider/raw/model");
  for (const output of [
    "raw text",
    " ".repeat(128 * 1024) + '{"message":"ok"}',
    '{"message":""}',
    '{"message":"ok","extra":1}',
    JSON.stringify({ message: "字".repeat(10001) }),
  ]) {
    generate.mockResolvedValue(output);
    await expect(
      core.generateApplicationText(
        preferences,
        "/workspace",
        { purpose: "optimize", text: "input" },
        signal,
        generate,
      ),
    ).rejects.toThrow();
  }
  generate.mockClear();
  await expect(
    core.generateApplicationText(
      preferences,
      "/workspace",
      { purpose: "commit", text: "diff" },
      AbortSignal.abort(),
      generate,
    ),
  ).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
});

it("保留原生已有 512 KiB Git 素材预算，并拒绝非法用途和前端覆盖字段", async () => {
  const generate = vi.fn().mockResolvedValue('{"message":"feat(acp): 迁移"}');
  const signal = new AbortController().signal;
  await expect(
    core.generateApplicationText(
      preferences,
      "/workspace",
      { purpose: "commit", text: "a".repeat(512 * 1024) },
      signal,
      generate,
    ),
  ).resolves.toBe("feat(acp): 迁移");
  generate.mockClear();
  for (const request of [
    { purpose: "optimize", text: " " },
    { purpose: "optimize", text: "a".repeat(32001) },
    { purpose: "commit", text: "diff", model: "override" },
  ])
    await expect(
      core.generateApplicationText(preferences, "/workspace", request as never, signal, generate),
    ).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
});

it("超时先传递取消并等待会话清理，标题只发送有界正文", async () => {
  const stop = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(stop.signal);
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generate = vi.fn<core.ApplicationTextGenerator>(
    async (_engine, _root, _prompt, _model, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      });
      await cleanup;
      signal.throwIfAborted();
      return "";
    },
  );
  try {
    const pending = core.generateApplicationText(
      preferences,
      "/workspace",
      { purpose: "optimize", text: "input" },
      new AbortController().signal,
      generate,
    );
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });
    stop.abort();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(pending).rejects.toThrow();
    expect(timeout).toHaveBeenCalledWith(120000);
  } finally {
    release();
    timeout.mockRestore();
  }
  const title = vi
    .fn<core.ApplicationTextGenerator>()
    .mockResolvedValue(JSON.stringify({ title: "名".repeat(40) }));
  expect(
    await core.generateApplicationText(
      preferences,
      "/workspace",
      { purpose: "title", text: "字".repeat(2000) },
      new AbortController().signal,
      title,
    ),
  ).toHaveLength(36);
  expect(title.mock.calls[0]?.[2]).toContain("字".repeat(1024));
  expect(title.mock.calls[0]?.[2]).not.toContain("字".repeat(1025));
});
