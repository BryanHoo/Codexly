import { browser, expect } from "@wdio/globals";

import {
  approvalTaskResponse,
  gitTaskResponse,
  longScrollTaskResponse,
  streamTaskResponse,
  taskResponse,
} from "./fixtures.js";
import {
  emitAgentEvent,
  installWebviewMocks,
  releaseApplicationStartup,
  type WebviewMocks,
} from "./mock-runtime.js";

let mocks: WebviewMocks;

async function waitForText(text: string): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute((expected) => document.body.innerText.includes(expected), text),
    { timeoutMsg: `页面未显示：${text}` },
  );
}

async function waitForCommand(command: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (name) =>
          (window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls[name]?.length ?? 0) > 0,
        command,
      ),
    { timeoutMsg: `未调用原生命令：${command}` },
  );
}

async function commandCallCount(command: string): Promise<number> {
  return browser.execute(
    (name) => window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls[name]?.length ?? 0,
    command,
  );
}

async function openTask(title: string, response: unknown): Promise<void> {
  await mocks.readTask.mockResolvedValue(response);
  const link = await $(`//a[.//span[normalize-space(.)="${title}"]]`);
  await link.waitForDisplayed();
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
}

describe("桌面原生 WebView 关键流程", () => {
  before(async () => {
    // 应用入口会等待此处安装 IPC mock，确保启动查询不触碰真实用户环境。
    mocks = await installWebviewMocks();
    await releaseApplicationStartup();
  });

  it("连接自定义 Provider 后进入工作台", async () => {
    const customMode = await $("aria/自定义 API");
    await customMode.waitForClickable();
    await customMode.click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/API Key（可选）").setValue("sk-webview-test");
    await $("aria/连接").click();

    await expect($('[aria-label="切换项目 CodeAgent"]')).toBeDisplayed();
  });

  it("接收流式消息并将运行中输入加入队列", async () => {
    await openTask("验证流式消息", streamTaskResponse);
    await waitForText("开始流式输出");
    await emitAgentEvent({
      itemId: "assistant-stream",
      payload: { delta: "原生流式消息完成" },
      provider: "codex",
      sequence: 1,
      sessionId: "session-stream-task",
      taskId: "stream-task",
      timestamp: "2026-08-30T02:00:01.000Z",
      turnId: "turn-stream",
      type: "message.delta",
      version: 2,
    });
    await waitForText("原生流式消息完成");

    await mocks.listQueue.mockResolvedValue({
      data: [
        {
          attachments: [],
          clientUserMessageId: "queue-client-1",
          id: "queue-1",
          skills: [],
          status: "queued",
          text: "排队补充测试",
        },
      ],
      nextCursor: null,
    });
    const composer = await $("aria/任务输入");
    await composer.click();
    await composer.setValue("排队补充测试");
    await $("aria/排队消息").click();
    await waitForText("排队补充测试");
    expect(await commandCallCount("add_queued_submission")).toBeGreaterThan(0);
  });

  it("切换到巨型任务后仅挂载末尾虚拟窗口并保持置底", async () => {
    await openTask(
      "推送GitHub打包，发布 GitHub Draft Release，本机gh可用",
      longScrollTaskResponse,
    );
    // 巨型任务切换后先让原生 WebKit 完成首轮虚拟窗口测量，避免同步文本读取阻塞布局。
    await browser.pause(1_000);
    await waitForText("最新回复标记");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () => {
            const turns = document.querySelectorAll('[data-virtual-row="turn"]');
            return turns.length > 0 && turns.length < 9;
          },
        ),
      { timeoutMsg: "巨型任务未按预期限制虚拟 Turn 挂载量" },
    );

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const container = document.querySelector<HTMLElement>('[role="log"]');
          if (container === null) return false;
          return container.scrollHeight - container.scrollTop - container.clientHeight < 24;
        }),
      { timeoutMsg: "虚拟 Turn 完成动态测量后未保持最新信息置底" },
    );
    const distanceFromBottom = await browser.execute(() => {
      const container = document.querySelector<HTMLElement>('[role="log"]');
      if (container === null) return Number.POSITIVE_INFINITY;
      return container.scrollHeight - container.scrollTop - container.clientHeight;
    });
    expect(distanceFromBottom).toBeLessThan(24);
  });

  it("在项目和任务之间切换且保持正确选中项", async () => {
    await $('[aria-label="切换项目 Codexly"]').click();
    await openTask("切换另一项目", taskResponse("other-task"));
    await expect($('[aria-label="切换项目 Codexly"]')).toHaveAttribute("aria-expanded", "true");
  });

  it("将键盘焦点交给审批主操作并完成审批", async () => {
    await openTask("处理命令审批", approvalTaskResponse);
    await waitForText("运行原生 WebView 测试");
    const allow = await $("aria/允许");
    await allow.waitForDisplayed();
    await browser.waitUntil(
      async () =>
        browser.execute(() => document.activeElement?.textContent?.trim() === "允许"),
      { timeoutMsg: "审批主操作未获得键盘焦点" },
    );
    await allow.click();
    await waitForCommand("resolve_pending_request");
    expect(await commandCallCount("resolve_pending_request")).toBeGreaterThan(0);
  });

  it("从检查器提交 Git 变更", async () => {
    await openTask("提交 Git 变更", gitTaskResponse);
    await waitForText("更新入口");
    const inspectorToggle = await $("#workbench-inspector-toggle");
    if ((await inspectorToggle.getAttribute("aria-label")) === "展开上下文面板") {
      await inspectorToggle.click();
    }
    await $("//button[@role=\"tab\" and .//span[normalize-space(.)=\"变更\"]]").click();
    await $("#commit-message").waitForDisplayed();
    await $("#commit-message").setValue("test(webview): 覆盖原生流程");
    await $("//button[normalize-space(.)=\"提交\"]").click();

    await waitForCommand("commit_project_changes");
    expect(await commandCallCount("commit_project_changes")).toBeGreaterThan(0);
  });

  it("后续重新打开巨型任务时仍保持最新位置置底", async () => {
    await openTask(
      "推送GitHub打包，发布 GitHub Draft Release，本机gh可用",
      longScrollTaskResponse,
    );
    await waitForText("最新回复标记");
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const container = document.querySelector<HTMLElement>('[role="log"]');
          if (container === null) return false;
          return container.scrollHeight - container.scrollTop - container.clientHeight < 24;
        }),
      { timeoutMsg: "后续重新打开巨型任务后未保持最新信息置底" },
    );
    const distanceFromBottom = await browser.execute(() => {
      const container = document.querySelector<HTMLElement>('[role="log"]');
      if (container === null) return Number.POSITIVE_INFINITY;
      return container.scrollHeight - container.scrollTop - container.clientHeight;
    });
    expect(distanceFromBottom).toBeLessThan(24);
  });
});
