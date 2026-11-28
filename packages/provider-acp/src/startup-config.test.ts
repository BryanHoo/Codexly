import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { AcpConfigOption, AcpConfigPreview } from "@codexly/protocol";
import { AcpStartupConfig } from "./startup-config.js";

const model = (value: string): AcpConfigOption => ({
  id: "model",
  name: "Model",
  type: "select",
  category: "model",
  currentValue: value,
  options: [
    { value: "one", name: "One" },
    { value: "two", name: "Two" },
  ],
});

it("跨宿主重启载入成功快照，模型选项互不覆盖，启动身份变化后隔离", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-startup-config-"));
  try {
    const baseline = [model("one")];
    const service = new AcpStartupConfig(directory, () => Promise.resolve("binding"));
    await service.refresh("codex", () =>
      Promise.resolve({ configOptions: baseline, values: { model: "one" } }),
    );
    await service.observe("codex", "binding", [
      model("two"),
      {
        id: "effort",
        name: "Effort",
        type: "select",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ]);
    const restarted = new AcpStartupConfig(directory, () => Promise.resolve("binding"));
    const result = await restarted.read("codex");
    expect(result?.values).toEqual({ model: "one" });
    expect(result?.modelOptions).toEqual([
      { modelId: "one", configOptions: [] },
      { modelId: "two", configOptions: [expect.objectContaining({ id: "effort" })] },
    ]);
    const upgraded = new AcpStartupConfig(directory, () => Promise.resolve("updated"));
    expect(await upgraded.read("codex")).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("同一 Agent 的前台请求取消后台探测且跳过迟到的结果", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acp-startup-config-"));
  try {
    const service = new AcpStartupConfig(directory, () => Promise.resolve("binding"));
    const started = Promise.withResolvers<AbortSignal>();
    const blocked = Promise.withResolvers<AcpConfigPreview>();
    const pending = service.refresh("codex", (signal) => {
      started.resolve(signal);
      return blocked.promise;
    });
    const probeSignal = await started.promise;
    const release = service.foreground("codex");
    expect(probeSignal.aborted).toBe(true);
    await expect(pending).resolves.toBeNull();
    blocked.resolve({ configOptions: [model("one")], values: {} });
    expect(await service.read("codex")).toBeNull();
    await service.rememberDefaults("codex", "binding", [model("two")]);
    expect(await service.read("codex")).toMatchObject({ values: { model: "two" } });
    release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
