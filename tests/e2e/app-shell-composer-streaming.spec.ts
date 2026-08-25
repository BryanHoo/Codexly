import { expect, taskSnapshot, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

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
    type MarkdownTableEventWindow = Window & {
      __emitMarkdownTableEvent?: (event: unknown) => void;
    };

    class MarkdownTableWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
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

      public send(): void {
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
