import { QueryClient } from "@tanstack/react-query";
import type { AcpConfigOption, AcpConfigPreview, AgentEngine } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import {
  modelScopedAcpOptions,
  readCachedAcpPreview,
  rememberAcpModelOptions,
  resetAcpModelOverrides,
  updateAcpPreviewOptions,
  warmAcpPreviews,
} from "./acp-preview-cache.js";

it("宿主快照立即展示，后台刷新保留预计等待期间从真实会话学到的配置", async () => {
  const cache = new QueryClient();
  const model: AcpConfigOption = {
    id: "model",
    name: "模型",
    type: "select",
    category: "model",
    currentValue: "one",
    options: [
      { value: "one", name: "One" },
      { value: "two", name: "Two" },
    ],
  };
  const mode: AcpConfigOption = { id: "allow", name: "权限", type: "boolean", currentValue: false };
  const one: AcpConfigOption = {
    id: "effort",
    name: "思考",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [{ value: "high", name: "高" }],
  };
  const two: AcpConfigOption = {
    ...one,
    currentValue: "low",
    options: [{ value: "low", name: "低" }],
  };
  const snapshot: AcpConfigPreview = {
    configOptions: [model, mode, one],
    values: { model: "one", allow: false, effort: "high" },
  };
  const refreshed = Promise.withResolvers<AcpConfigPreview>();
  try {
    const warm = warmAcpPreviews(
      cache,
      ["codex"],
      () => refreshed.promise,
      1_000,
      () => Promise.resolve(snapshot),
    );
    await vi.waitFor(() => {
      expect(readCachedAcpPreview(cache, "codex")).toEqual(snapshot);
    });
    expect(modelScopedAcpOptions(snapshot.configOptions, snapshot, { model: "two" })).toEqual([
      model,
      mode,
    ]);
    rememberAcpModelOptions(cache, "codex", [{ ...model, currentValue: "two" }, two]);
    refreshed.resolve(snapshot);
    await warm;
    const current = readCachedAcpPreview(cache, "codex");
    expect(modelScopedAcpOptions(snapshot.configOptions, current, { model: "two" })).toEqual([
      model,
      mode,
      two,
    ]);
    expect(
      resetAcpModelOverrides(
        snapshot.configOptions,
        current,
        { effort: "high", allow: true },
        "model",
        "two",
      ),
    ).toEqual({ allow: true });
    rememberAcpModelOptions(cache, "claude", [{ ...model, currentValue: "two" }, mode, two]);
    expect(readCachedAcpPreview(cache, "claude")).toMatchObject({
      configOptions: [{ ...model, currentValue: "" }],
      values: {},
      modelOptions: [{ modelId: "two", configOptions: [two] }],
    });
  } finally {
    cache.clear();
  }
});

it("按顺序跳过超时和掉线的 Agent，同次启动只读取一次", async () => {
  const cache = new QueryClient();
  const preview = { configOptions: [], values: { flag: false } };
  const load = vi.fn((engine: AgentEngine) => {
    if (engine === "codex") return new Promise<never>(() => undefined);
    if (engine === "claude") return Promise.reject(new Error("ACP_AUTH_REQUIRED"));
    return Promise.resolve(preview);
  });
  const engines = ["codex", "claude", "acp-codefree-o"] as const;
  try {
    const warm = warmAcpPreviews(cache, engines, load, 20);
    expect(load.mock.calls.map(([engine]) => engine)).toEqual(["codex"]);
    await Promise.all([warm, warmAcpPreviews(cache, engines, load, 20)]);
    expect(load.mock.calls.map(([engine]) => engine)).toEqual(engines);
    expect(readCachedAcpPreview(cache, "acp-codefree-o")).toEqual(preview);
    expect(readCachedAcpPreview(cache, "codex")).toBeUndefined();
  } finally {
    cache.clear();
  }
});

it("修改默认配置后直接更新选项，迟到的启动读取不能覆盖保存回执", async () => {
  const cache = new QueryClient();
  const response = Promise.withResolvers<NonNullable<ReturnType<typeof readCachedAcpPreview>>>();
  const load = vi.fn(() => response.promise);
  try {
    const initial = warmAcpPreviews(cache, ["codex"], load);
    updateAcpPreviewOptions(cache, "codex", [
      { id: "allow", name: "允许写入", type: "boolean", currentValue: false },
    ]);
    response.resolve({ values: { allow: true }, configOptions: [] });
    await initial;
    await warmAcpPreviews(cache, ["codex"], load);
    expect(readCachedAcpPreview(cache, "codex")?.values).toEqual({ allow: false });
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    cache.clear();
  }
});
