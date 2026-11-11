import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcpConfigPreviewRequest, AcpScheduledConfigView, ScheduledTask, SetAcpScheduledConfig } from "@codexly/protocol";
import { ScheduledTaskEditor as WebEditor } from "../../../apps/web/src/features/scheduled-tasks/components/scheduled-task-editor.js";
import { ScheduledTaskEditor as NativeEditor } from "../../src/features/scheduled-tasks/scheduled-task-editor.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/scheduled-tasks.css";

const legacy = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/src/features/workbench/components/workbench-composer.js", () => ({
  WorkbenchComposer: () => { legacy(); return <div>旧版输入框</div>; },
}));
vi.mock("../../src/features/workbench/components/workbench-composer.js", () => ({
  WorkbenchComposer: () => { legacy(); return <div>旧版输入框</div>; },
}));

const task: ScheduledTask = {
  id: "plan", name: "每日巡检", projectId: "p", projectName: "项目甲", enabled: false,
  prompt: { type: "prompt", text: "检查项目", skills: [], attachments: [] },
  messageAttachments: [], runs: [], createdAtUnixMs: 1, updatedAtUnixMs: 2,
  nextRunAtUnixMs: 2_000_000_000_000,
  schedule: { type: "once", atUnixMs: 2_000_000_000_000 },
  turnOptions: { model: "old", approvalPolicy: "never", sandboxMode: "workspace-write" },
};
function fixture() {
  const view = { projectId: "p", canEdit: true, config: null };
  const client = {
    getAcpScheduledConfig: vi.fn(async (): Promise<AcpScheduledConfigView> => view),
    previewAcpConfig: vi.fn(async (_project: string, _engine: string, input: AcpConfigPreviewRequest) => {
      const values = { model: "a", allow: false, ...input.values,
        ...(input.change ? { [input.change.configId]: input.change.value } : {}) };
      return { values, configOptions: [
        { id: "model", name: "原生模型", type: "select", currentValue: values.model,
          options: [{ value: "a", name: "甲" }, { value: "b", name: "乙" }] },
        { id: "allow", name: "原生开关", type: "boolean", currentValue: values.allow },
      ] };
    }),
    setAcpScheduledConfig: vi.fn(async (_id: string, input: SetAcpScheduledConfig, _options?: { idempotencyKey?: string }) => ({
      ...view, config: { engine: input.engine, values: input.values, revision: 1 },
    })),
  };
  return client;
}
beforeEach(async () => {
  await page.viewport(1440, 900);
  legacy.mockClear();
  await webLanguage("zh-CN");
  await nativeLanguage("zh-CN");
});
for (const [platform, Editor] of [["Web", WebEditor], ["Native", NativeEditor]] as const) {
  it(`${platform}：390px 长名称和英文操作保持在计划面板内`, async () => {
    await page.viewport(390, 844);
    await webLanguage("en"); await nativeLanguage("en");
    const client = fixture();
    const props = { task: { ...task, name: "VeryLongScheduledProjectReviewNameWithoutSpaces" }, acpClient: client,
      composerProps: { capabilities: { runtime: "acp" }, settings: task.turnOptions },
      onOpenRun: vi.fn(), onRunNow: vi.fn(), onSave: vi.fn(), onProjectChange: vi.fn(),
      onEnabledChange: vi.fn(), onPreview: vi.fn(), projectId: "p", projects: [], skills: [],
    };
    const screen = await render(<QueryClientProvider client={new QueryClient()}><Editor {...props as never} /></QueryClientProvider>);
    const configure = screen.getByRole("button", { name: "Configure agent", exact: true });
    await expect.element(configure).toBeEnabled();
    const run = screen.getByRole("button", { name: "Run now", exact: true });
    await expect.poll(() => Math.round(run.element().getBoundingClientRect().right)).toBeLessThanOrEqual(390);
    const toolbar = configure.element().closest(".scheduled-task-editor__toolbar")!;
    expect(run.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(toolbar.getBoundingClientRect().bottom);
    await configure.click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog").element().getBoundingClientRect().right).toBeLessThanOrEqual(390);
    await screen.unmount();
  });

  it(`${platform}：重新打开配置读取最新修订，避免取消后持续使用陈旧缓存`, async () => {
    const client = fixture();
    const saved = { projectId: "p", canEdit: true,
      config: { engine: "codex" as const, values: { model: "a", allow: false }, revision: 1 } };
    client.getAcpScheduledConfig.mockResolvedValue(saved);
    const props = { task, acpClient: client,
      composerProps: { capabilities: { runtime: "acp" }, settings: task.turnOptions },
      onOpenRun: vi.fn(), onRunNow: vi.fn(), onSave: vi.fn(), onProjectChange: vi.fn(),
      onPreview: vi.fn(), projectId: "p", projects: [], skills: [],
    };
    const screen = await render(<QueryClientProvider client={new QueryClient()}><Editor {...props as never} /></QueryClientProvider>);
    await screen.getByRole("button", { name: "配置智能体", exact: true }).click();
    await expect.element(screen.getByRole("combobox", { name: "原生模型" })).toHaveValue("a");
    await screen.getByText("取消", { exact: true }).click();
    client.getAcpScheduledConfig.mockResolvedValue({ ...saved,
      config: { ...saved.config, revision: 2 } });
    await screen.getByRole("button", { name: "配置智能体", exact: true }).click();
    const model = screen.getByRole("combobox", { name: "原生模型" });
    await model.selectOptions("b");
    await expect.element(model).toHaveValue("b");
    await screen.getByRole("button", { name: "保存配置", exact: true }).click();
    await expect.poll(() => client.setAcpScheduledConfig.mock.calls[0]?.[1].expectedRevision).toBe(2);
    expect(legacy).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it(`${platform}：放弃预览会中止请求，迟到响应不能写入重新打开的草稿`, async () => {
    const client = fixture();
    let resolve!: (value: Awaited<ReturnType<typeof client.previewAcpConfig>>) => void;
    let signal: AbortSignal | undefined;
    const actual = client.previewAcpConfig.getMockImplementation()!;
    client.previewAcpConfig.mockImplementationOnce((_project, _engine, _input, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise((done) => { resolve = done; });
    });
    const props = { task, acpClient: client,
      composerProps: { capabilities: { runtime: "acp" }, settings: task.turnOptions },
      onOpenRun: vi.fn(), onRunNow: vi.fn(), onSave: vi.fn(), onProjectChange: vi.fn(),
      onPreview: vi.fn(), projectId: "p", projects: [], skills: [],
    };
    const screen = await render(<QueryClientProvider client={new QueryClient()}><Editor {...props as never} /></QueryClientProvider>);
    await screen.getByRole("button", { name: "配置智能体", exact: true }).click();
    await screen.getByRole("combobox", { name: "智能体", exact: true }).selectOptions("codex");
    await screen.getByText("取消", { exact: true }).click();
    await expect.element(screen.getByRole("dialog", { name: "放弃未保存的配置？" })).toBeVisible();
    await screen.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect.poll(() => signal?.aborted).toBe(true);
    resolve(await actual("p", "codex", { values: { model: "b" } }));
    await screen.getByRole("button", { name: "配置智能体", exact: true }).click();
    await expect.element(screen.getByRole("combobox", { name: "智能体", exact: true })).toHaveValue("");
    await expect.element(screen.getByRole("combobox", { name: "原生模型" })).not.toBeInTheDocument();
    expect(client.setAcpScheduledConfig).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    await screen.unmount();
  });
  it(`${platform}：运行结果未确认时仍可查看历史任务，禁止配置和重发`, async () => {
    const client = fixture();
    client.getAcpScheduledConfig.mockResolvedValue({ projectId: "p", canEdit: false, config: null });
    const open = vi.fn();
    const props = { task: { ...task, runs: [{ id: "r", taskId: "original", status: "failed",
        startedAtUnixMs: 1, finishedAtUnixMs: 2, error: "outcome unknown" }] }, acpClient: client,
      composerProps: { capabilities: { runtime: "acp" }, settings: task.turnOptions },
      onOpenRun: open, onRunNow: vi.fn(), onSave: vi.fn(), onProjectChange: vi.fn(),
      onPreview: vi.fn(), projectId: "p", projects: [], skills: [],
    };
    const screen = await render(<QueryClientProvider client={new QueryClient()}><Editor {...props as never} /></QueryClientProvider>);
    await expect.element(screen.getByText(/计划正在运行/)).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "配置智能体", exact: true })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "立即运行", exact: true })).toBeDisabled();
    await screen.getByRole("button", { name: "查看任务", exact: true }).click();
    expect(open).toHaveBeenCalledWith("p", "original");
    expect(client.previewAcpConfig).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it(`${platform}：已有计划只用 ACP，明确确认并保存原始配置，失败重试保持身份`, async () => {
    const client = fixture();
    client.setAcpScheduledConfig.mockRejectedValueOnce(new Error("offline"));
    const props = { task, acpClient: client,
      composerProps: { capabilities: { runtime: "acp" }, settings: task.turnOptions },
      onOpenRun: vi.fn(), onRunNow: vi.fn(), onSave: vi.fn(), onProjectChange: vi.fn(),
      onPreview: vi.fn(async () => ({ dates: [] })), projectId: "p", projects: [], skills: [],
    };
    const screen = await render(<QueryClientProvider client={new QueryClient()}>
      <Editor {...props as never} />
    </QueryClientProvider>);
    await screen.getByRole("button", { name: "配置智能体", exact: true }).click();
    expect(legacy).not.toHaveBeenCalled();
    expect(client.previewAcpConfig).not.toHaveBeenCalled();
    await screen.getByRole("combobox", { name: "智能体", exact: true }).selectOptions("claude");
    const model = screen.getByRole("combobox", { name: "原生模型" });
    await expect.element(model).toHaveValue("a");
    await model.selectOptions("b");
    await expect.element(model).toHaveValue("b");
    const save = screen.getByRole("button", { name: "保存配置", exact: true });
    await expect.element(save).toBeDisabled();
    await screen.getByRole("checkbox", { name: "确认使用以上智能体配置运行此计划" }).click();
    await save.click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("offline");
    await expect.element(model).toHaveValue("b");
    await save.click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(client.setAcpScheduledConfig).toHaveBeenCalledWith("plan", {
      projectId: "p", engine: "claude", expectedRevision: 0, confirmMigration: true,
      values: { model: "b", allow: false },
    }, expect.objectContaining({ idempotencyKey: expect.any(String) }));
    const calls = client.setAcpScheduledConfig.mock.calls;
    expect(calls[0]?.[2]).toEqual(calls[1]?.[2]);
    await screen.unmount();
  });
}
