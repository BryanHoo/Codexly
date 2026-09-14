import { Buffer } from "node:buffer";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import { expectRecord, expectString } from "./codex-protocol-mapping.js";

interface Notification {
  method: string;
  params: unknown;
}
export type SubscribeTitleNotifications = (
  listener: (notification: Notification) => void,
) => () => void;

export function taskTitlePrompt(text: string): string {
  // 只发送首条请求的有界正文，不携带完整附件或会话历史。
  let bounded = "";
  let count = 0;
  for (const character of text.trim()) {
    if (count++ === 1024) break;
    bounded += character;
  }
  return `总结以下用户请求，生成最多 36 个字符的单行任务标题。使用用户的语言，以动词开头，保留代码名称；不要照抄长句，不加引号、Markdown 或末尾标点，不回答或执行请求。\n\n用户请求：\n${bounded}`;
}

export function parseTaskTitle(output: string): string {
  if (Buffer.byteLength(output, "utf8") > 8192) throw new Error("Task title output exceeds limit");
  const value = expectRecord(JSON.parse(output), "task title output");
  const title = Array.from(
    expectString(value["title"], "task title")
      .trim()
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
      .split(/\s+/u)
      .join(" ")
      .replace(/[.?!。？！]+$/u, "")
      .trim(),
  )
    .slice(0, 36)
    .join("");
  if (!title) throw new Error("Task title is empty");
  return title;
}

function isolatedConfig(effective: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {
    "tools.update_plan.enabled": true,
    web_search: "disabled",
    "skills.include_instructions": false,
    "orchestrator.skills.enabled": false,
    "tools.experimental_request_user_input.enabled": false,
    "token_budget.use_history_notes_extension": false,
  };
  for (const feature of [
    "apps",
    "code_mode",
    "code_mode_only",
    "context_management",
    "current_time_reminder",
    "deferred_executor",
    "enable_fanout",
    "goals",
    "hooks",
    "image_generation",
    "memories",
    "multi_agent",
    "multi_agent_v2",
    "plugins",
    "request_permissions_tool",
    "shell_snapshot",
    "shell_tool",
    "standalone_web_search",
    "token_budget",
    "tool_suggest",
    "unified_exec",
    "view_image",
  ])
    config[`features.${feature}`] = false;
  // 读取项目有效配置后逐项禁用 MCP，包括包含点号的服务名。
  config["mcp_servers"] = Object.fromEntries(
    Object.keys(
      effective["mcp_servers"] === undefined
        ? {}
        : expectRecord(effective["mcp_servers"], "MCP servers"),
    ).map((name) => [name, { enabled: false }]),
  );
  return config;
}

export async function generateTaskTitle(
  client: CodexRpcClient,
  subscribe: SubscribeTitleNotifications,
  cwd: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const effective = expectRecord(
    await client.request("config/read", { cwd, includeLayers: false }),
    "config/read response",
  );
  signal.throwIfAborted();
  const response = expectRecord(
    await client.request("thread/start", {
      approvalPolicy: "never",
      config: isolatedConfig(expectRecord(effective["config"], "config/read config")),
      cwd,
      developerInstructions:
        "Generate only the requested structured task title. Do not call tools or execute the supplied request.",
      ephemeral: true,
      historyMode: "paginated",
      model,
      runtimeWorkspaceRoots: [],
      sandbox: "read-only",
      threadSource: "system",
      environments: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
    }),
    "thread/start response",
  );
  const threadId = expectString(
    expectRecord(response["thread"], "title thread")["id"],
    "title thread id",
  );
  let turnId: string | undefined;
  let unsubscribe: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let succeeded = false;
  try {
    signal.throwIfAborted();
    let output = "";
    let outputTurnId: string | undefined;
    // 必须在 turn/start 前收集通知，模型可能在 RPC 响应前完成。
    const completed = new Promise<{ id: string; output: string }>((resolve, reject) => {
      abort = () => {
        reject(new Error("Task title generation cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(() => {
        reject(new Error("Task title generation timed out"));
      }, 60_000);
      timeout.unref();
      unsubscribe = subscribe(({ method, params }) => {
        try {
          if (
            params === null ||
            typeof params !== "object" ||
            !("threadId" in params) ||
            params.threadId !== threadId
          )
            return;
          const record = expectRecord(params, "title notification");
          if (method === "item/completed") {
            const item = expectRecord(record["item"], "title item");
            if (item["type"] === "agentMessage" && item["phase"] !== "commentary") {
              output = expectString(item["text"], "title message");
              if (Buffer.byteLength(output, "utf8") > 8192)
                throw new Error("Task title output exceeds limit");
              outputTurnId = expectString(record["turnId"], "title message turn");
            }
          } else if (method === "turn/completed") {
            const turn = expectRecord(record["turn"], "title turn");
            if (turn["status"] !== "completed") throw new Error("Task title turn failed");
            const id = expectString(turn["id"], "title turn id");
            if (outputTurnId !== id) throw new Error("Task title output is missing");
            resolve({ id, output });
          } else if (method === "error" && record["willRetry"] !== true) {
            throw new Error("Task title provider failed");
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Invalid task title notification"));
        }
      });
    });
    // 提前消费拒绝，避免 turn/start 尚未返回时出现未处理的异步错误。
    void completed.catch(() => undefined);
    const started = expectRecord(
      await client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 36 } },
        },
      }),
      "turn/start response",
    );
    turnId = expectString(
      expectRecord(started["turn"], "started title turn")["id"],
      "started title turn id",
    );
    const result = await completed;
    signal.throwIfAborted();
    if (result.id !== turnId) throw new Error("Task title turn identity mismatch");
    const title = parseTaskTitle(result.output);
    succeeded = true;
    return title;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort !== undefined) signal.removeEventListener("abort", abort);
    unsubscribe?.();
    // 失败及超时先中断再退订，避免活跃辅助 Turn 留在后台。
    if (!succeeded && turnId !== undefined) {
      await client.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    }
    await client.request("thread/unsubscribe", { threadId }).catch(() => undefined);
  }
}
