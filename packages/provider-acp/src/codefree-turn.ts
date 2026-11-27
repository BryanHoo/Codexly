import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { answerCodefreeQuestion, type CodefreeQuestion } from "./codefree-interaction.js";
import type { CodefreeServer } from "./codefree-server.js";

interface NativePart {
  id: string;
  messageID: string;
  type: string;
  text?: string;
  ignored?: boolean;
  url?: string;
  mime?: string;
  filename?: string;
  callID: string;
  tool: string;
  state: {
    status: string;
    title?: string;
    input?: Record<string, unknown>;
    metadata?: { filediff?: { file: string; before: string; after: string } };
    output?: string;
    error?: string;
  };
}
export interface NativeMessage {
  info: {
    id: string;
    role: string;
    agent?: string;
    model?: { providerID: string; modelID: string };
  };
  parts: NativePart[];
}
type Client = acp.AgentRequestContext<acp.PromptRequest>["client"];
type Notify = (update: acp.SessionUpdate) => Promise<void>;
/** 增量与最终快照可能交错；按原生 part 记录已转发长度，避免结尾重复，也保留纯快照输出。 */
export class CodefreeOutput {
  private readonly parts = new Map<string, { type: string; length: number; messageId: string }>();
  private readonly tools = new Set<string>();
  constructor(
    readonly notify: Notify,
    readonly cwd = process.cwd(),
  ) {}
  async delta(id: string, text: string) {
    const part = this.parts.get(id);
    if (!part || !text) return;
    part.length += text.length;
    await this.notify({
      messageId: part.messageId,
      sessionUpdate: part.type === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
      content: { type: "text", text },
    });
  }
  async part(part: NativePart, user = false) {
    if (part.ignored) return;
    if (part.type === "file" && part.url) {
      const data = /^data:([^;,]+);base64,([\s\S]*)$/.exec(part.url);
      const content: acp.ContentBlock =
        data?.[1]?.startsWith("image/") && data[2]
          ? { type: "image", mimeType: data[1], data: data[2] }
          : {
              type: "resource_link",
              uri: part.url,
              name: part.filename ?? "附件",
              ...(part.mime ? { mimeType: part.mime } : {}),
            };
      await this.notify({
        sessionUpdate: user ? "user_message_chunk" : "agent_message_chunk",
        messageId: part.messageID,
        content,
      });
      return;
    }
    if (part.type === "text" || part.type === "reasoning") {
      if (user) {
        if (part.text)
          await this.notify({
            sessionUpdate: "user_message_chunk",
            messageId: part.messageID,
            content: { type: "text", text: part.text },
          });
        return;
      }
      if (!this.parts.has(part.id))
        this.parts.set(part.id, { type: part.type, length: 0, messageId: part.messageID });
      await this.delta(part.id, (part.text ?? "").slice(this.parts.get(part.id)?.length));
    } else if (part.type === "tool" && !user) {
      const state = part.state;
      const status =
        state.status === "running"
          ? "in_progress"
          : state.status === "error"
            ? "failed"
            : state.status === "completed"
              ? "completed"
              : "pending";
      const kind: Record<string, acp.ToolKind> = {
        bash: "execute",
        shell: "execute",
        read: "read",
        edit: "edit",
        write: "edit",
        apply_patch: "edit",
        grep: "search",
        glob: "search",
        webfetch: "fetch",
        task: "think",
      };
      const file = state.input?.["filePath"] ?? state.input?.["path"];
      const diff = state.metadata?.filediff;
      const text = state.output ?? state.error;
      const call: acp.ToolCall = {
        kind: kind[part.tool] ?? "other",
        ...(typeof file === "string" ? { locations: [{ path: resolve(this.cwd, file) }] } : {}),
        ...(diff && typeof diff.file === "string" && typeof diff.after === "string"
          ? {
              content: [
                {
                  type: "diff" as const,
                  path: resolve(this.cwd, diff.file),
                  oldText: diff.before,
                  newText: diff.after,
                },
              ],
            }
          : text
            ? { content: [{ type: "content" as const, content: { type: "text" as const, text } }] }
            : {}),
        toolCallId: part.callID,
        title: state.title ?? part.tool,
        status,
        rawInput: state.input,
        rawOutput: state.output ?? state.error,
      };
      await this.notify(
        this.tools.has(part.callID)
          ? { ...call, sessionUpdate: "tool_call_update" }
          : { ...call, sessionUpdate: "tool_call" },
      );
      this.tools.add(part.callID);
    }
  }
}

export function promptPart(block: acp.ContentBlock) {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      if (!block.data && !block.uri) throw new Error("图片缺少数据或资源地址");
      return {
        type: "file",
        mime: block.mimeType,
        url: block.data ? `data:${block.mimeType};base64,${block.data}` : block.uri,
      };
    case "resource": {
      const resource = block.resource;
      if ("text" in resource) return { type: "text", text: resource.text };
      const mime = resource.mimeType ?? "application/octet-stream";
      return { type: "file", mime, url: `data:${mime};base64,${resource.blob}` };
    }
    case "resource_link":
      return {
        type: "file",
        filename: block.name,
        mime: block.mimeType ?? "application/octet-stream",
        url: block.uri,
      };
    default:
      throw new Error("CodeFree O 不支持此输入内容");
  }
}

interface NativeEvent {
  type: string;
  properties: {
    sessionID: string;
    messageID: string;
    info?: {
      id: string;
      role: string;
      finish?: string;
      title?: string;
      time?: { updated?: number };
      tokens?: {
        input: number;
        output: number;
        reasoning: number;
        cache: { read: number; write: number };
      };
    };
    todos?: { content: string; status: string; priority: string }[];
    part?: NativePart;
    text?: string;
    field: string;
    delta: string;
    partID: string;
    id: string;
    permission: string;
    always?: string[];
    patterns: string[];
    questions: CodefreeQuestion[];
    tool?: { callID: string };
    error?: { name: string; data?: { message?: string } };
  };
}
/** 直接消费 HTTP 字节流，按完整 UTF-8 行解码；取消时由异步迭代器释放读取锁。 */
async function* eventLines(body: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body) {
    const lines = (pending + decoder.decode(chunk, { stream: true })).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
}
export interface CodefreeTurnState {
  cancel: AbortController;
  admitted: boolean;
}

/** 先建立事件订阅再提交 prompt。每轮仅处理所属会话的事件，空闲时关闭事件流。 */
export async function runCodefreeTurn(
  server: CodefreeServer,
  cwd: string,
  client: Client,
  params: acp.PromptRequest,
  model: string,
  mode: string,
  turn: CodefreeTurnState,
  commands: Promise<{ name: string }[]>,
  contextLimit?: number,
  variant?: string,
  compaction = false,
  formElicitation = false,
) {
  const { sessionId } = params;
  const isCancelled = () => turn.cancel.signal.aborted;
  const path = "/session/" + encodeURIComponent(sessionId);
  const stream = new AbortController();
  const notify = (update: acp.SessionUpdate) =>
    client.notify(acp.methods.client.session.update, { sessionId, update });
  const output = new CodefreeOutput(notify, cwd);
  const assistants = new Set<string>();
  let finish: string | undefined;
  try {
    const split = model.indexOf("/");
    const parts = params.prompt.map(promptPart);
    const text = parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    const slash = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
    if (slash?.[1] === "compact") {
      const compactionId = randomUUID();
      if (isCancelled()) return { stopReason: "cancelled" as const };
      turn.admitted = true;
      if (compaction)
        await notify({ sessionUpdate: "compaction_update", compactionId, status: "in_progress" });
      try {
        if (
          !isCancelled() &&
          !(await server.json<boolean>(path + "/summarize", cwd, {
            providerID: model.slice(0, split),
            modelID: model.slice(split + 1),
            auto: false,
          }))
        )
          throw new Error("CodeFree O 未完成压缩");
        if (compaction)
          await notify({
            sessionUpdate: "compaction_update",
            compactionId,
            status: isCancelled() ? "cancelled" : "completed",
          });
        return { stopReason: isCancelled() ? ("cancelled" as const) : ("end_turn" as const) };
      } catch (error) {
        if (compaction)
          await notify({
            sessionUpdate: "compaction_update",
            compactionId,
            status: isCancelled() ? "cancelled" : "failed",
          });
        throw error;
      }
    }
    const response = await server.request("/event", cwd, undefined, stream.signal);
    if (!response.body) throw new Error("CodeFree O 未返回事件流");
    if (isCancelled()) return { stopReason: "cancelled" as const };
    const command = slash && (await commands).some((c) => c.name === slash[1]);
    if (isCancelled()) return { stopReason: "cancelled" as const };
    if (command) {
      // command 接口等待整轮完成；并行消费 SSE 才能在执行中处理权限交互。
      void server
        .request(
          path + "/command",
          cwd,
          {
            command: slash[1],
            arguments: slash[2] ?? "",
            parts: parts.filter((p) => p.type === "file"),
            ...(model ? { model } : {}),
            ...(mode ? { agent: mode } : {}),
            ...(variant ? { variant } : {}),
          },
          stream.signal,
        )
        .then((response) => response.body?.cancel())
        .catch((reason: unknown) => {
          stream.abort(reason);
        });
    } else {
      const submitted = await server.request(path + "/prompt_async", cwd, {
        ...(model
          ? { model: { providerID: model.slice(0, split), modelID: model.slice(split + 1) } }
          : {}),
        ...(mode ? { agent: mode } : {}),
        ...(variant ? { variant } : {}),
        parts,
      });
      await submitted.body?.cancel();
    }
    turn.admitted = true;
    if (isCancelled()) await server.json(path + "/abort", cwd, {});
    const lines = eventLines(response.body);
    for await (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const { type, properties: p } = JSON.parse(line.slice(5)) as NativeEvent;
      if (p.sessionID !== sessionId) continue;
      if (type === "message.updated" && p.info?.role === "assistant") {
        assistants.add(p.info.id);
        finish = p.info.finish;
        const tokens = p.info.tokens;
        if (contextLimit && tokens && p.info.finish)
          await notify({
            sessionUpdate: "usage_update",
            size: contextLimit,
            used: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output,
          });
      }
      if (type === "message.part.updated" && p.part && assistants.has(p.part.messageID))
        await output.part(p.part);
      if (type === "message.part.delta" && p.field === "text" && assistants.has(p.messageID))
        await output.delta(p.partID, p.delta);
      if (type === "todo.updated" && p.todos)
        await notify({
          sessionUpdate: "plan",
          entries: p.todos
            .filter((t) => t.status !== "cancelled")
            .map((t) => ({
              content: t.content,
              status:
                t.status === "completed"
                  ? "completed"
                  : t.status === "in_progress"
                    ? "in_progress"
                    : "pending",
              priority: t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium",
            })),
        });
      if (type === "session.updated" && p.info?.title)
        await notify({
          sessionUpdate: "session_info_update",
          title: p.info.title,
          ...(p.info.time?.updated
            ? { updatedAt: new Date(p.info.time.updated).toISOString() }
            : {}),
        });
      if (compaction && type === "session.next.compaction.started")
        await notify({
          sessionUpdate: "compaction_update",
          compactionId: p.messageID,
          status: "in_progress",
        });
      if (compaction && type === "session.next.compaction.delta" && p.text)
        await notify({
          sessionUpdate: "compaction_summary_chunk",
          compactionId: p.messageID,
          content: { type: "text", text: p.text },
        });
      if (compaction && type === "session.next.compaction.ended")
        await notify({
          sessionUpdate: "compaction_update",
          compactionId: p.messageID,
          status: "completed",
          ...(p.text ? { summary: [{ type: "text", text: p.text }] } : {}),
        });
      if (type === "permission.asked") {
        const decision = await client.request(
          acp.methods.client.session.requestPermission,
          {
            sessionId,
            toolCall: {
              toolCallId: p.tool?.callID ?? p.id,
              title: [p.permission, ...p.patterns].join(" "),
            },
            options: [
              { optionId: "once", kind: "allow_once", name: "允许一次" },
              ...(p.always?.length
                ? [{ optionId: "always", kind: "allow_always" as const, name: "始终允许" }]
                : []),
              { optionId: "reject", kind: "reject_once", name: "拒绝" },
            ],
          },
          { cancellationSignal: turn.cancel.signal, stopWaitingOnCancel: true },
        );
        const reply =
          decision.outcome.outcome === "selected" &&
          (decision.outcome.optionId === "once" ||
            (decision.outcome.optionId === "always" && p.always?.length))
            ? decision.outcome.optionId
            : "reject";
        await server.json("/permission/" + encodeURIComponent(p.id) + "/reply", cwd, { reply });
      }
      if (type === "question.asked") {
        // 客户端未声明表单能力时，显式回绝当前问题，使原生工具能够结束等待。
        if (formElicitation)
          await answerCodefreeQuestion(
            server,
            cwd,
            client,
            sessionId,
            p.id,
            p.questions,
            turn.cancel.signal,
          );
        else await server.json("/question/" + encodeURIComponent(p.id) + "/reject", cwd, {});
      }
      if (type === "session.error") {
        if (isCancelled()) return { stopReason: "cancelled" as const };
        throw new Error(p.error?.data?.message ?? p.error?.name ?? "CodeFree O 执行失败");
      }
      if (
        type === "session.idle" ||
        (type === "session.status" &&
          "status" in p &&
          (p.status as { type: string }).type === "idle")
      ) {
        return {
          stopReason: isCancelled()
            ? ("cancelled" as const)
            : finish === "content-filter"
              ? ("refusal" as const)
              : finish === "length"
                ? ("max_tokens" as const)
                : ("end_turn" as const),
        };
      }
    }
    throw new Error("CodeFree O 事件流提前结束");
  } catch (error) {
    if (turn.admitted && !server.signal.aborted)
      await server.json(path + "/abort", cwd, {}).catch(() => undefined);
    if (isCancelled()) return { stopReason: "cancelled" as const };
    throw error;
  } finally {
    stream.abort();
  }
}
