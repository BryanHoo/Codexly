import {
  enableLanAccess,
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  test,
} from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("downloads a streaming Markdown file reference from the same context menu", async ({
  page,
}) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }
  await enableLanAccess(page);
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  id: "message-streaming-file-reference",
                  role: "assistant",
                  text: "核心实现：[live.ts](/tmp/generated/live.ts:12)",
                  type: "message",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.route("**/v1/projects/codexly/files/download?*", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("path")).toBe("/tmp/generated/live.ts");
    await route.fulfill({
      body: "export const live = true;",
      contentType: "application/octet-stream",
      headers: { "content-disposition": 'attachment; filename="live.ts"' },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const fileReference = page.locator('[data-file-reference="true"]');
  await expect(fileReference).toContainText("live.ts");
  await fileReference.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "在独立窗口打开" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载文件" }).click();

  expect((await downloadPromise).suggestedFilename()).toBe("live.ts");
});

test("downloads a completed streaming file change from its LAN context menu", async ({ page }) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }
  await enableLanAccess(page);
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  changes: [
                    {
                      diff: "+export const live = true;",
                      kind: "update",
                      path: "src/live.ts",
                    },
                  ],
                  id: "file-live",
                  status: "completed",
                  type: "file_change",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.route("**/v1/projects/codexly/files/download?*", async (route) => {
    await route.fulfill({
      body: "export const live = true;",
      contentType: "application/octet-stream",
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const fileChange = page.locator('[data-file-change="update"]');
  await expect(fileChange).toContainText("live.ts");
  await fileChange.click({ button: "right" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载文件" }).click();

  expect((await downloadPromise).suggestedFilename()).toBe("live.ts");
});

test("keeps a streaming code block within the conversation and copies its code", async ({
  context,
  page,
}) => {
  const streamedCode = `const streamed = "${"x".repeat(2_000)}";`;
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [
                {
                  id: "message-streaming-code",
                  role: "assistant",
                  text: `\`\`\`typescript\n${streamedCode}\n\`\`\``,
                  type: "message",
                },
              ],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.goto("/p/codexly/t/task-1");

  const copyButton = page.locator('[data-streamdown="code-block-copy-button"]');
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toBeEnabled();
  const conversation = page.getByRole("log", { name: "会话内容" });
  expect(await conversation.evaluate((element) => element.scrollWidth)).toBe(
    await conversation.evaluate((element) => element.clientWidth),
  );
  await copyButton.click();
  await expect
    // Windows 剪贴板会把 LF 转为 CRLF，比较前统一为应用内部换行格式。
    .poll(() =>
      page
        .evaluate(() => navigator.clipboard.readText())
        .then((text) => text.replaceAll("\r\n", "\n")),
    )
    .toBe(`${streamedCode}\n`);
});

test("renders a streaming Markdown table as a semantic table", async ({ page }) => {
  const historicalTurn = taskSnapshot.turns[0];
  if (historicalTurn === undefined) {
    throw new Error("Expected the task fixture to contain a turn");
  }
  const firstTableChunk = [
    "结论。",
    "",
    "| 优先级 | 当前实现 | 替换方案 |",
    "|---|---|---|",
    "| P0 | `pendingOperations.shift()` | `p-limit` |",
  ].join("\n");
  const secondTableChunk = "\n| P1 | `Value.Check()` | Ajv |";

  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...historicalTurn,
              completedAt: null,
              items: [],
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    type MarkdownTableEventWindow = Window & {
      __emitMarkdownTableEvent?: (event: unknown) => void;
    };

    class MarkdownTableWebSocket extends EventTarget {
      public readonly bufferedAmount: number = 0;
      public readyState = 0;

      public constructor(url: string) {
        super();
        // 仅接管项目事件，避免定时任务连接覆盖流式消息的测试入口。
        if (new URL(url).pathname !== "/v1/projects/codexly/events") {
          return new NativeWebSocket(url);
        }
        (window as MarkdownTableEventWindow).__emitMarkdownTableEvent = (event) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
            }),
          );
        };
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(_data: string | BufferSource | Blob): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: MarkdownTableWebSocket,
    });
  });
  await page.goto("/p/codexly/t/task-1");

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as Window & { __emitMarkdownTableEvent?: (event: unknown) => void })
            .__emitMarkdownTableEvent,
      ),
    )
    .toBe("function");
  const emitDelta = async (delta: string, sequence: number) => {
    await page.evaluate(
      ({ delta, sequence, turnId }) => {
        const emit = (window as Window & { __emitMarkdownTableEvent?: (event: unknown) => void })
          .__emitMarkdownTableEvent;
        if (emit === undefined) {
          throw new Error("Markdown table event emitter is unavailable");
        }
        emit({
          itemId: "message-streaming-table",
          payload: { delta },
          provider: "codex",
          sequence,
          sessionId: "e2e-session",
          taskId: "task-1",
          timestamp: "2026-08-25T00:00:00.000Z",
          turnId,
          type: "message.delta",
          version: 2,
        });
      },
      { delta, sequence, turnId: historicalTurn.id },
    );
  };

  await emitDelta(firstTableChunk, 1);

  const table = page.locator('[data-streamdown="table"]');
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "优先级" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "p-limit" })).toBeVisible();

  await emitDelta(secondTableChunk, 2);
  await expect(table.getByRole("cell", { name: "Ajv" })).toBeVisible();
});
