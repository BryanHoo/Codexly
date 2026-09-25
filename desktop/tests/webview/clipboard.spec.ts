import { browser, expect } from "@wdio/globals";
import { taskResponse } from "./fixtures.js";
import { installWebviewMocks, releaseApplicationStartup } from "./mock-runtime.js";

const markdown = '# 原始 Markdown\n\n**保留标记**\n\n- 列表\n\n```ts\nconst text = "<原文>";\n```';

async function clipboard(command: "read_text" | "write_text", text?: string): Promise<string> {
  const result = await browser.executeAsync((operation, value, done) => {
    const core = (window as unknown as {
      __TAURI__: { core: { invoke: (command: string, args: unknown) => Promise<string | undefined> } };
    }).__TAURI__.core;
    core.invoke(`plugin:clipboard-manager|${operation}`, { text: value }).then(
      (content) => done({ content: content ?? "", error: null }),
      (error: unknown) => done({ content: "", error: String(error) }),
    );
  }, command, text);
  if (result.error !== null) throw new Error(result.error);
  return result.content;
}

async function readClipboardOrEmpty(): Promise<string> {
  try {
    return await clipboard("read_text");
  } catch (error) {
    // CI 的全新桌面会话可能没有剪贴板格式，等价于空文本而不是插件故障。
    if (String(error).includes("clipboard contents were not available")) return "";
    throw error;
  }
}

describe("原生 Markdown 剪贴板", () => {
  before(async () => {
    const mocks = await installWebviewMocks();
    await browser.execute(() => {
      const bridge = window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__!;
      bridge.defaults.retain_task_subscription = null;
      bridge.defaults.release_task_subscription = null;
    });
    const response = taskResponse("git-task");
    await mocks.readTask.mockResolvedValue({
      ...response,
      snapshot: {
        ...response.snapshot,
        turns: [{
          id: "clipboard-turn", status: "completed", error: null,
          startedAt: "2026-09-11T00:00:00.000Z", completedAt: "2026-09-11T00:00:01.000Z",
          items: [{ id: "clipboard-answer", type: "message", role: "assistant", text: markdown }],
        }],
      },
    });
    await releaseApplicationStartup();
    await $("aria/自定义 API").click();
    await $("aria/API Base URL").setValue("https://gateway.test/v1");
    await $("aria/连接").click();
    await $('//a[.//span[normalize-space(.)="提交 Git 变更"]]').click();
    await $("aria/复制 Markdown").waitForDisplayed();
  });

  it("网页剪贴板拒绝权限时仍从任务按钮写入系统剪贴板", async () => {
    const previousText = await readClipboardOrEmpty();
    try {
      // 强制复现网页权限拒绝；插件 IPC 保持真实，验证注册、权限与系统写入整条链路。
      await browser.execute(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () => Promise.reject(new DOMException("The request is not allowed", "NotAllowedError")),
        });
      });
      await clipboard("write_text", "clipboard-before-copy");
      await $("aria/复制 Markdown").click();
      await browser.waitUntil(async () => (await clipboard("read_text")) === markdown, {
        timeoutMsg: "原生剪贴板未收到完整的原始 Markdown",
      });
      expect(await clipboard("read_text")).toBe(markdown);
    } finally {
      await clipboard("write_text", previousText);
      await browser.execute(() => { Reflect.deleteProperty(navigator.clipboard, "writeText"); });
    }
  });
});
