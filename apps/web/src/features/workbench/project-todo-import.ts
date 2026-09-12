import type { CodexlyClient } from "@codexly/client";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createLegacyTodoImporter(
  client: Pick<CodexlyClient, "importProjectTodo">,
  storage: Pick<Storage, "getItem" | "setItem">,
  onError: (error: unknown) => void,
) {
  const attempts = new Map<string, Promise<void>>();
  const migrate = async (projectId: string) => {
    let entries: unknown;
    try {
      entries = record(
        JSON.parse(storage.getItem(`codexly:project-todos:v1:${projectId}`) ?? "null"),
      )?.["todos"];
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    for (const entry of entries as unknown[]) {
      const id = record(entry)?.["id"];
      if (typeof id !== "string" || id.length === 0) continue;
      const key = `codexly:project-todo:v1:${projectId}:${id}`;
      try {
        if (storage.getItem(`${key}:imported`) === "1") continue;
        const previous = record(JSON.parse(storage.getItem(key) ?? "null"));
        const source = record(previous?.["workingDraft"] ?? previous?.["draft"]);
        const attachments = source?.["attachments"];
        const draft = {
          content: source?.["content"],
          attachments: Array.isArray(attachments)
            ? (attachments as unknown[]).map((item) => {
                const metadata = record(item);
                return {
                  id: metadata?.["id"],
                  kind: metadata?.["kind"],
                  mediaType: metadata?.["mediaType"],
                  name: metadata?.["name"],
                  size: metadata?.["size"],
                };
              })
            : undefined,
        };
        await client.importProjectTodo(projectId, id, draft, { idempotencyKey: `import:${id}` });
        // 保留旧记录作为备份；只有正文与附件都由后端确认后才写入迁移标记。
        storage.setItem(`${key}:imported`, "1");
      } catch (error) {
        onError(error);
      }
    }
  };
  return (projectId: string) => {
    let attempt = attempts.get(projectId);
    if (attempt === undefined) {
      attempt = migrate(projectId);
      attempts.set(projectId, attempt);
    }
    return attempt;
  };
}
