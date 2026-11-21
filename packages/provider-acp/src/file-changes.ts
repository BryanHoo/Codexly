import { DiffChange, ToolCallContent } from "@agentclientprotocol/sdk/experimental/v2/unstable";
import type { AgentItem } from "@codexly/protocol";

type Change = Extract<AgentItem, { type: "file_change" }>["changes"][number];
const MAX_FILES = 128;
const MAX_PATCH = 64 * 1024;

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** 结构化路径是事实来源。只在补丁文件头能唯一匹配时挂载预览。 */
export function projectAcpFileChanges(content: ToolCallContent[] | null, budget: number): Change[] {
  const changes = new Map<string, Change>();
  for (const block of content ?? []) {
    if (!ToolCallContent.isDiff(block)) continue;
    const current = new Map<string, Change>();
    for (const change of block.changes) {
      const operation = change.operation;
      if (
        !DiffChange.isAdd(change) &&
        !DiffChange.isDelete(change) &&
        !DiffChange.isModify(change) &&
        !DiffChange.isMove(change) &&
        !DiffChange.isCopy(change)
      )
        continue;
      if (!change.path || change.path.length > 4096) continue;
      const path = normalizePath(change.path);
      if (!changes.has(path) && changes.size >= MAX_FILES) continue;
      const kind =
        operation === "delete"
          ? "delete"
          : operation === "add" || operation === "copy"
            ? "create"
            : "update";
      const projected: Change = {
        path: change.path,
        diff: "",
        kind,
        acp: {
          operation: change.operation,
          ...(change.fileType ? { fileType: change.fileType.slice(0, 128) } : {}),
          ...(change.mimeType ? { mimeType: change.mimeType.slice(0, 128) } : {}),
          ...("oldPath" in change &&
          typeof change.oldPath === "string" &&
          change.oldPath.length <= 4096
            ? { oldPath: change.oldPath }
            : {}),
        },
      };
      changes.set(path, projected);
      current.set(path, projected);
    }

    const patch = block.patch;
    if (patch?.format !== "git_patch" || patch.text.length > MAX_PATCH || !budget) continue;
    for (const section of patch.text.split(/(?=^diff --git )/m)) {
      const hunk = section.search(/^@@ /m);
      const header = hunk === -1 ? section : section.slice(0, hunk);
      const before = /^--- ([^\r\n]+)/m.exec(header)?.[1];
      const after = /^\+\+\+ ([^\r\n]+)/m.exec(header)?.[1];
      const rawPath = after === "/dev/null" ? before : after;
      if (!rawPath) continue;
      const path = normalizePath(rawPath.split("\t", 1)[0] ?? "").replace(/^[ab]\//, "");
      const files = [...current].filter(([file]) => file === path || file.endsWith("/" + path));
      if (files.length !== 1) continue;
      const file = files[0]?.[1];
      if (!file || file.diff) continue;
      const bytes = Buffer.byteLength(JSON.stringify(section));
      if (bytes > budget) continue;
      file.diff = section;
      budget -= bytes;
    }
  }
  return [...changes.values()];
}
