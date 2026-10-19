import type { AgentItem } from "@codexly/protocol";
import type { FileEditOutput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { record, resultText, text } from "./sdk-values.js";

type ToolItem = Extract<AgentItem, { type: "tool" }>;
type Hunk = FileEditOutput["structuredPatch"][number];

/** 消息级结果只有唯一工具块时才可安全配对；批量回放不能按数组位置猜测归属。 */
export function claudeStructuredResult(
  content: unknown[],
  message: Record<string, unknown>,
): unknown {
  return content.filter((value) => record(value)["type"] === "tool_result").length === 1
    ? message["tool_use_result"]
    : undefined;
}

/** 结构化结果仍是 unknown；校验行标记和行数，避免把无效数据当作可审阅补丁。 */
function isHunk(value: unknown): value is Hunk {
  const hunk = record(value);
  if (
    !["oldStart", "oldLines", "newStart", "newLines"].every(
      (key) => Number.isSafeInteger(hunk[key]) && (hunk[key] as number) >= 0,
    ) ||
    !Array.isArray(hunk["lines"])
  )
    return false;
  let oldLines = 0,
    newLines = 0;
  for (const line of hunk["lines"]) {
    if (typeof line !== "string" || line.includes("\n")) return false;
    if (line.startsWith(" ")) {
      oldLines++;
      newLines++;
    } else if (line.startsWith("-")) oldLines++;
    else if (line.startsWith("+")) newLines++;
    else if (line !== "\\ No newline at end of file") return false;
  }
  return oldLines === hunk["oldLines"] && newLines === hunk["newLines"];
}

function diffPath(prefix: string, path: string): string {
  const value = `${prefix}/${path.replaceAll("\\", "/").replace(/^\/+/, "")}`;
  // 路径可含空格和控制字符；遵循 Git 的引号形式，不能让文件名注入额外补丁行。
  return /[\s"\\]/u.test(value) ? JSON.stringify(value) : value;
}

function fileResult(item: ToolItem, output: Record<string, unknown>): AgentItem | undefined {
  const path = text(output["filePath"]),
    patch = output["structuredPatch"];
  if (
    !path ||
    path.length > 8192 ||
    output["staged"] === true ||
    !Array.isArray(patch) ||
    !patch.every(isHunk)
  )
    return;
  const kind = item.name === "Write" ? output["type"] : "update";
  if (kind !== "create" && kind !== "update") return;
  if (item.name === "Write" && typeof output["content"] !== "string") return;
  if (
    item.name === "Edit" &&
    (typeof output["oldString"] !== "string" || typeof output["newString"] !== "string")
  )
    return;
  // 空补丁可能是无变化或 SDK 放弃计算；仅在结果明确提供相同前后内容时认定无变化。
  if (
    kind === "update" &&
    patch.length === 0 &&
    (item.name === "Edit" || output["originalFile"] === output["content"])
  )
    return;
  let diff = "";
  const header = `--- ${kind === "create" ? "/dev/null" : diffPath("a", path)}\n+++ ${diffPath("b", path)}\n`;
  if (patch.length > 0) {
    diff =
      header +
      patch
        .map(
          (hunk) =>
            `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@\n${hunk.lines.join("\n")}\n`,
        )
        .join("");
  } else if (kind === "create") {
    // Write 新建文件的 structuredPatch 正常为空，只能使用成功结果中的实际内容。
    const content = text(output["content"]),
      lines = content ? content.split("\n") : [];
    if (content.endsWith("\n")) lines.pop();
    diff =
      header +
      `@@ -0,0 +1,${String(lines.length)} @@\n` +
      lines.map((line) => `+${line}\n`).join("") +
      (content && !content.endsWith("\n") ? "\\ No newline at end of file\n" : "");
  }
  return { id: item.id, type: "file_change", status: "completed", changes: [{ path, kind, diff }] };
}

/** 只在对应 tool_result 到达后细分类型，审批阶段的输入绝不能充当执行证据。 */
export function projectClaudeToolResult(
  item: ToolItem,
  value: unknown,
  block: Record<string, unknown>,
  cwd: string,
): AgentItem | undefined {
  const output = record(value),
    failed = block["is_error"] === true;
  if (item.name === "Write" || item.name === "Edit")
    return failed ? undefined : fileResult(item, output);
  if (item.name !== "Bash") return;
  // 后台派发尚无最终输出，图片也不是终端文本；保留原工具结果，避免伪造命令完成。
  if (output["backgroundTaskId"] || output["isImage"] === true) return;
  const command = text(record(item.input)["command"]);
  if (!command) return;
  const stdout = text(output["stdout"]),
    stderr = text(output["stderr"]);
  const structured = typeof output["stdout"] === "string" && typeof output["stderr"] === "string";
  return {
    id: item.id,
    type: "command",
    command,
    cwd,
    // stdout 已含交错的进程输出；stderr 是工具自身提示，不据此推断命令失败。
    output: structured
      ? stdout + (stdout && stderr && !stdout.endsWith("\n") ? "\n" : "") + stderr
      : resultText(block["content"]),
    outputOmitted: { bytes: 0, lines: 0 },
    status: output["interrupted"] === true ? "interrupted" : failed ? "failed" : "completed",
    // SDK BashOutput 不提供可靠退出码；不从成功状态或模型可见文本中猜测。
  };
}
