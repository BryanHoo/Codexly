import { page, userEvent } from "vitest/browser";
import {
  AcpModelSelector,
  AcpComposerLeading,
  AcpComposerReasoning,
} from "@codexly/ui/core/acp-model-selector";
import { AcpComposerSettingsContext } from "@codexly/ui/core/acp-composer-settings";
import { ComposerToolbar } from "@codexly/ui/core/composer-toolbar";
import { useAcpDraftComposer } from "@codexly/ui/core/acp-draft-composer";
import { SelectedEnginesContext } from "@codexly/ui/core/engine-selection";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { AcpConfigOption, AcpConfigPreviewRequest, AgentEngine } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";
const options: AcpConfigOption[] = [
  {
    id: "model",
    category: "model",
    name: "Model",
    type: "select",
    currentValue: "sol",
    options: [
      { value: "sol", name: "6.1 Sol" },
      { value: "luna", name: "5.6 Luna" },
    ],
  },
  {
    id: "thinking",
    category: "thought_level",
    name: "Thinking",
    type: "select",
    currentValue: "off",
    options: [
      { value: "off", name: "Off" },
      { value: "high", name: "High" },
    ],
  },
];
function Draft() {
  const draft = useAcpDraftComposer({
    client,
    projectId: "selector-proof",
    workspace: "/work",
    initialEngine: "codex",
    configurationLabel: "配置",
    engineLabel: "Agent",
    retryLabel: "重试",
  });
  return <div>{draft.controls}</div>;
}
const client = {
  previewAcpConfig: vi.fn(
    async (_project: string, engine: AgentEngine, request: AcpConfigPreviewRequest) => {
      const model =
        engine === "claude" ? "opus" : (request.change?.value ?? request.values.model ?? "sol");
      return {
        values: { model, thinking: "off" },
        configOptions:
          engine === "claude"
            ? [{ ...options[0]!, currentValue: "opus", options: [{ value: "opus", name: "Opus" }] }]
            : options.map((option) =>
                option.id === "model" ? { ...option, currentValue: model } : option,
              ),
      };
    },
  ),
};
it("合并 Agent 与模型入口，保留原始模型值并支持搜索和收藏", async () => {
  sessionStorage.clear();
  localStorage.removeItem("codexly:acp-model-favorites:v1");
  const screen = await render(
    <SelectedEnginesContext value={["codex", "claude"]}>
      <Draft />
    </SelectedEnginesContext>,
  );
  await expect
    .element(screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }).click();
  expect(document.querySelector("[cmdk-group-heading]")).toBeNull();
  await screen.getByRole("button", { name: "收藏 5.6 Luna", exact: true }).click();
  await screen.getByRole("tab", { name: "收藏", exact: true }).click();
  await expect.element(screen.getByRole("option", { name: /5.6 Luna/ })).toBeVisible();
  await screen.getByRole("option", { name: /5.6 Luna/ }).click();
  await expect
    .element(screen.getByRole("button", { name: "Codex / 5.6 Luna", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Codex / 5.6 Luna", exact: true }).click();
  await screen.getByRole("tab", { name: "Claude", exact: true }).click();
  await screen.getByRole("option", { name: /Opus/ }).click();
  await expect
    .element(screen.getByRole("button", { name: "Claude / Opus", exact: true }))
    .toBeVisible();
  await screen.unmount();
});

it("历史会话锁定 Agent，搜索支持键盘选取，配置入口打开 ACP 设置", async () => {
  const onSelect = vi.fn();
  const openSettings = vi.fn();
  const screen = await render(
    <AcpComposerSettingsContext value={openSettings}>
      <AcpModelSelector
        engine="codex"
        engines={["codex", "claude"]}
        options={options}
        disabled={false}
        error={null}
        locked
        onSelect={onSelect}
      />
    </AcpComposerSettingsContext>,
  );
  await screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }).click();
  await expect
    .element(screen.getByRole("tab", { name: "Claude", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("combobox").fill("Luna");
  await expect.element(screen.getByRole("option", { name: /6.1 Sol/ })).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /收藏 6.1 Sol/ }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(onSelect).toHaveBeenCalledWith("codex", "model", "luna");
  await screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }).click();
  await screen.getByRole("button", { name: "配置 Agent", exact: true }).click();
  expect(openSettings).toHaveBeenCalledOnce();
  await screen.unmount();
});
it.each([
  { width: 360, theme: "light" },
  { width: 1280, theme: "light" },
  { width: 360, theme: "dark" },
  { width: 1280, theme: "dark" },
])("$width px $theme 工具栏思考在发送左侧，模型列表保持视口边界", async ({ width, theme }) => {
  document.documentElement.dataset.theme = theme;
  await page.viewport(width, 800);
  const screen = await render(
    <AcpComposerSettingsContext value={vi.fn()}>
      <div className="bg-content p-3 text-foreground" style={{ marginTop: 400 }}>
        <ComposerToolbar
          leading={<span>+</span>}
          model={
            <AcpModelSelector
              engine="codex"
              engines={["codex", "claude"]}
              options={options}
              disabled={false}
              error={null}
              onSelect={vi.fn()}
            />
          }
          moreLabel="更多"
          title="配置"
          items={[
            {
              id: "acp-reasoning",
              label: "思考",
              pinned: true,
              trailing: true,
              control: (
                <AcpComposerReasoning
                  options={options}
                  disabled={false}
                  error={null}
                  label="输入配置"
                  onChange={vi.fn()}
                />
              ),
            },
          ]}
          actions={<button type="button">发送</button>}
        />
      </div>
    </AcpComposerSettingsContext>,
  );
  const thinking = screen.getByRole("button", { name: "思考强度", exact: true });
  // 翻译依照 Agent 原始名称映射；当前 Thinking 显示为“思考强度”。
  const leading = document.querySelector("[data-composer-leading]")!;
  expect(leading.textContent).not.toContain("关闭");
  const trailing = document.querySelector("[data-composer-trailing]")!;
  expect(trailing.textContent).toContain("关闭");
  expect(thinking.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    document.querySelector("[data-composer-actions]")!.getBoundingClientRect().left,
  );
  expect(document.querySelector("[data-composer-model]")?.textContent).toContain("Codex / 6.1 Sol");
  await expect.element(thinking).toBeVisible();
  const trigger = screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true });
  await userEvent.hover(screen.getByRole("button", { name: "发送", exact: true }));
  expect(getComputedStyle(trigger.element()).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  await userEvent.hover(trigger);
  await expect
    .poll(() => getComputedStyle(trigger.element()).backgroundColor, { timeout: 1500 })
    .not.toBe("rgba(0, 0, 0, 0)");
  await trigger.click();
  const dialog = screen.getByRole("dialog").element();
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: `../../test-results/acp-model-selector-${width}-${theme}.png` });
  await screen.unmount();
  delete document.documentElement.dataset.theme;
  await page.viewport(1440, 900);
});

it("浏览其他 Agent 仅按需读取，关闭浮层取消请求并忽略迟到结果", async () => {
  let signal: AbortSignal | undefined;
  let finish!: (options: readonly AcpConfigOption[]) => void;
  const loadOptions = vi.fn((_engine: AgentEngine, abort: AbortSignal) => {
    signal = abort;
    return new Promise<readonly AcpConfigOption[]>((resolve) => {
      finish = resolve;
    });
  });
  const select = vi.fn();
  const screen = await render(
    <AcpModelSelector
      engine="codex"
      engines={["codex", "claude"]}
      options={options}
      disabled={false}
      error={null}
      onSelect={select}
      loadOptions={loadOptions}
    />,
  );
  expect(loadOptions).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }).click();
  await screen.getByRole("tab", { name: "Claude", exact: true }).click();
  await expect.poll(() => loadOptions.mock.calls.length).toBe(1);
  expect(select).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  expect(signal?.aborted).toBe(true);
  finish(options);
  await expect
    .element(screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }))
    .toBeVisible();
  expect(select).not.toHaveBeenCalled();
  await screen.unmount();
});

it("跨 Agent 协商未完成时切换项目，不让旧选择锁住新项目草稿", async () => {
  let claudeReads = 0;
  const preview = vi.fn(async (_project: string, engine: AgentEngine) => {
    if (engine === "claude" && ++claudeReads > 1) return new Promise<never>(() => {});
    return { values: { model: "sol" }, configOptions: options };
  });
  const scopedClient = { previewAcpConfig: preview };
  function ScopedDraft({ projectId }: { projectId: string }) {
    const draft = useAcpDraftComposer({
      client: scopedClient,
      projectId,
      workspace: "/work",
      initialEngine: "codex",
      configurationLabel: "配置",
      engineLabel: "Agent",
      retryLabel: "重试",
    });
    return (
      <div>
        {draft.controls}
        <output data-testid="busy">{String(draft.isBusy)}</output>
      </div>
    );
  }
  const renderDraft = (projectId: string) => (
    <SelectedEnginesContext value={["codex", "claude"]}>
      <ScopedDraft projectId={projectId} />
    </SelectedEnginesContext>
  );
  const screen = await render(renderDraft("pending-scope-a"));
  await expect.element(screen.getByTestId("busy")).toHaveTextContent("false");
  await screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }).click();
  await screen.getByRole("tab", { name: "Claude", exact: true }).click();
  await screen.getByRole("option", { name: /6.1 Sol/ }).click();
  await expect.element(screen.getByTestId("busy")).toHaveTextContent("true");
  await screen.rerender(renderDraft("pending-scope-b"));
  await expect.element(screen.getByTestId("busy")).toHaveTextContent("false");
  await expect
    .element(screen.getByRole("button", { name: "Codex / 6.1 Sol", exact: true }))
    .toBeVisible();
  await screen.unmount();
});

it("配置直接使用公共下拉，隐藏说明并随界面语言切换，原始值保持不变", async () => {
  const change = vi.fn();
  const controls: AcpConfigOption[] = [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "agent-full-access",
      options: [
        { value: "manual", name: "Manual" },
        { value: "agent", name: "Auto review" },
        { value: "agent-full-access", name: "Full access" },
      ],
      description: "Approval and sandboxing preset for the session",
    },
    {
      id: "collaboration_mode",
      name: "Collaboration mode",
      type: "select",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
      description: "How Codex collaborates for subsequent turns",
    },
    {
      id: "web-search",
      name: "Web search",
      type: "boolean",
      currentValue: false,
      description: "1.5x speed, increased usage",
    },
  ];
  const screen = await render(
    <AcpComposerLeading
      options={controls}
      disabled={false}
      error={null}
      label="输入配置"
      language="zh-CN"
      onChange={change}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "权限模式", exact: true }))
    .toHaveTextContent("完全访问");
  expect(document.querySelector("select")).toBeNull();
  expect(document.body.textContent).not.toContain("Approval and sandboxing");
  await screen.getByRole("button", { name: "权限模式", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "每次询问", exact: true }))
    .toBeVisible();
  await screen.getByRole("menuitemradio", { name: "自动审核", exact: true }).click();
  expect(change).toHaveBeenLastCalledWith("mode", "agent");
  await screen.getByRole("button", { name: "联网搜索", exact: true }).click();
  await screen.getByRole("menuitemradio", { name: "开启", exact: true }).click();
  expect(change).toHaveBeenLastCalledWith("web-search", true);
  await screen.getByRole("button", { name: "协作模式", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "计划", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await screen.rerender(
    <AcpComposerLeading
      options={controls}
      disabled={false}
      error={null}
      label="Configuration"
      language="en"
      onChange={change}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Mode", exact: true }))
    .toHaveTextContent("Full access");
  await screen.getByRole("button", { name: "Collaboration mode", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "Plan", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "计划", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});

it.each([360, 1280])("%s px 配置工具栏保持紧凑且收起后仍可选择", async (width) => {
  await page.viewport(width, 800);
  const change = vi.fn();
  const controls: AcpConfigOption[] = [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "agent-full-access",
      options: [
        { value: "agent", name: "Auto review" },
        { value: "agent-full-access", name: "Full access" },
      ],
    },
    {
      id: "collaboration_mode",
      name: "Collaboration mode",
      type: "select",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
    },
    { id: "web-search", name: "Web search", type: "boolean", currentValue: false },
  ];
  const screen = await render(
    <div className="bg-content p-3 text-foreground" style={{ marginTop: 400 }}>
      <ComposerToolbar
        leading={
          <button aria-label="添加图片或文件" type="button">
            +
          </button>
        }
        model={
          <AcpModelSelector
            engine="codex"
            options={options}
            disabled={false}
            error={null}
            onSelect={vi.fn()}
          />
        }
        items={[
          {
            id: "acp-config",
            label: "",
            control: (
              <AcpComposerLeading
                options={controls}
                disabled={false}
                error={null}
                label="输入配置"
                onChange={change}
              />
            ),
          },
        ]}
        moreLabel="更多"
        title="配置"
        actions={<button type="button">发送</button>}
      />
    </div>,
  );
  if (width === 360) await screen.getByRole("button", { name: "更多", exact: true }).click();
  const mode = screen.getByRole("button", { name: "权限模式", exact: true });
  await expect.element(mode).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `../../test-results/acp-compact-toolbar-${width}.png` });
  await mode.click();
  await screen.getByRole("menuitemradio", { name: "自动审核", exact: true }).click();
  expect(change).toHaveBeenCalledWith("mode", "agent");
  await screen.unmount();
  await page.viewport(1440, 900);
});
