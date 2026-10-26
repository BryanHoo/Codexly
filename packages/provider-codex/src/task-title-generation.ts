import { Buffer } from "node:buffer";
import type { CodexRpcClient } from "./codex-rpc-client.js";
import {
  CODEX_EPHEMERAL_THREAD_CONFIG,
  expectRecord,
  expectString,
} from "./codex-protocol-mapping.js";
import titleInstructions from "./task-title-instructions.json" with { type: "json" };

interface Notification {
  method: string;
  params: unknown;
}
export type SubscribeTitleNotifications = (
  listener: (notification: Notification) => void,
) => () => void;

export { taskTitlePrompt, parseTaskTitle } from "@codexly/core";
import { parseTaskTitle, taskTitlePrompt } from "@codexly/core";

function isolatedConfig(effective: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...CODEX_EPHEMERAL_THREAD_CONFIG,
    // 工具隔离不会屏蔽 AGENTS.md；标题仅需请求正文，禁止加载项目文档中的提交格式等规则。
    project_doc_max_bytes: 0,
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
  instructions = "",
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
      // 专用基础指令覆盖自定义模型提示；开发者指令约束仍可能注入的全局 AGENTS.md。
      // 与桌面端共用静态指令，构建时打包，不增加文件读取或额外模型请求。
      baseInstructions: titleInstructions.baseInstructions,
      developerInstructions: instructions.trim() || titleInstructions.developerInstructions,
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

/** 运行时与跨引擎标题请求共用同一隔离和清理路径。 */
export function generateRuntimeTaskTitle(
  client: CodexRpcClient,
  cwd: string,
  text: string,
  model: string,
  signal: AbortSignal,
  instructions = "",
): Promise<string> {
  return generateTaskTitle(
    client,
    (listener) => client.onNotification(listener),
    cwd,
    model,
    taskTitlePrompt(text, instructions),
    signal,
    instructions,
  );
}
