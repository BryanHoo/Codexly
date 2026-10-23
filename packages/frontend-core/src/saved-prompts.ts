export type SavedPromptDraft = Readonly<{
  name: string;
  content: string;
  projectId?: string;
}>;
export type SavedPrompt = SavedPromptDraft & Readonly<{ id: string }>;
export type SavedPromptError = "name" | "content" | "duplicate" | "project";
export const SAVED_PROMPTS_STORAGE_KEY = "codexly.saved-prompts.v1";
export const savedPromptLimits = { name: 80, content: 20_000 } as const;
type PromptStorage = Pick<Storage, "getItem" | "setItem">;

/** 标题直接用于候选匹配，允许中文、空格和标点，不再要求独立快捷词。 */
export function validateSavedPrompt(draft: SavedPromptDraft): SavedPromptError | null {
  if (
    draft.projectId !== undefined &&
    (typeof draft.projectId !== "string" || !draft.projectId.trim())
  )
    return "project";
  if (!draft.name.trim() || draft.name.trim().length > savedPromptLimits.name) return "name";
  if (!draft.content.trim() || draft.content.length > savedPromptLimits.content) return "content";
  return null;
}

function parsePrompts(raw: string | null): readonly SavedPrompt[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== "object" ||
      data === null ||
      !("version" in data) ||
      data.version !== 1 ||
      !("prompts" in data) ||
      !Array.isArray(data.prompts)
    )
      return [];
    const ids = new Set<string>();
    return data.prompts.flatMap((entry: unknown): SavedPrompt[] => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as SavedPrompt;
      if (
        typeof value.id !== "string" ||
        !value.id ||
        typeof value.name !== "string" ||
        typeof value.content !== "string" ||
        validateSavedPrompt(value)
      )
        return [];
      if (ids.has(value.id)) return [];
      ids.add(value.id);
      // 旧版同名不同快捷词可能对应不同正文：按 ID 保留全部记录，且只投影仍使用的字段。
      return [
        {
          id: value.id,
          name: value.name.trim(),
          content: value.content,
          ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
        },
      ];
    });
  } catch {
    return [];
  }
}

/** 存储只在首次读取、外部变更和显式写入时访问，输入匹配不重复解析磁盘数据。 */
export function createSavedPromptStore(storage: PromptStorage) {
  let raw: string | null | undefined;
  let snapshot: readonly SavedPrompt[] = [];
  const listeners = new Set<() => void>();
  const refresh = () => {
    const nextRaw = storage.getItem(SAVED_PROMPTS_STORAGE_KEY);
    if (raw === nextRaw) return;
    raw = nextRaw;
    snapshot = parsePrompts(raw);
    for (const listener of listeners) listener();
  };
  const getSnapshot = () => {
    if (raw === undefined) {
      try {
        refresh();
      } catch {
        raw = null;
        /* 读取被浏览器限制时仍允许打开管理页，写入失败会明确反馈。 */
      }
    }
    return snapshot;
  };
  const commit = (next: readonly SavedPrompt[]) => {
    const serialized = JSON.stringify({ version: 1, prompts: next });
    // 先落盘再发布状态；配额或权限错误必须保留原列表和编辑草稿。
    storage.setItem(SAVED_PROMPTS_STORAGE_KEY, serialized);
    raw = serialized;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    save(draft: SavedPromptDraft, id?: string): SavedPrompt {
      const error = validateSavedPrompt(draft);
      if (error) throw new Error(error);
      // 写前读取另一窗口最新列表，避免用长期缓存覆盖其他窗口已保存的记录。
      refresh();
      const title = draft.name.trim().toLocaleLowerCase();
      const original = id ? snapshot.find((item) => item.id === id) : undefined;
      // 允许原范围内编辑旧版同名记录；新增、改名或移动范围仍要求标题唯一。
      const unchangedTitle =
        original?.projectId === draft.projectId && original?.name.toLocaleLowerCase() === title;
      if (
        !unchangedTitle &&
        snapshot.some(
          (item) =>
            item.id !== id &&
            item.projectId === draft.projectId &&
            item.name.toLocaleLowerCase() === title,
        )
      )
        throw new Error("duplicate");
      const prompt: SavedPrompt = {
        name: draft.name.trim(),
        content: draft.content,
        ...(draft.projectId === undefined ? {} : { projectId: draft.projectId }),
        id: id ?? crypto.randomUUID(),
      };
      commit(
        id && snapshot.some((item) => item.id === id)
          ? snapshot.map((item) => (item.id === id ? prompt : item))
          : [...snapshot, prompt],
      );
      return prompt;
    },
    // 删除项目先预检本机写权限；失败时阻止远端删除，保留项目及提示词供用户重试。
    assertProjectRemovalWritable(projectId: string) {
      refresh();
      if (snapshot.some((item) => item.projectId === projectId)) {
        storage.setItem(
          SAVED_PROMPTS_STORAGE_KEY,
          raw ?? JSON.stringify({ version: 1, prompts: snapshot }),
        );
      }
    },
    removeProject(projectId: string) {
      refresh();
      const next = snapshot.filter((item) => item.projectId !== projectId);
      if (next.length !== snapshot.length) commit(next);
    },
    remove(id: string) {
      refresh();
      commit(snapshot.filter((item) => item.id !== id));
    },
  };
}

/** 常用提示词复用现有命令选择契约，但执行仅插入正文，不启动任务。 */
export function getSavedPromptCommands(prompts: readonly SavedPrompt[]) {
  return prompts.map((prompt) => ({
    action: "saved-prompt" as const,
    id: `saved-prompt:${prompt.id}`,
    label: prompt.name,
    keywords: [prompt.name],
    description: prompt.content.slice(0, 160).replace(/\s+/gu, " "),
    content: prompt.content,
  }));
}

/** 当前项目可使用全局及本项目提示词；同标题由项目版本覆盖，其他项目绝不进入候选。 */
export function selectSavedPromptsForProject(prompts: readonly SavedPrompt[], projectId?: string) {
  const scoped = projectId ? prompts.filter((prompt) => prompt.projectId === projectId) : [];
  const overridden = new Set(scoped.map((prompt) => prompt.name.toLocaleLowerCase()));
  return [
    ...scoped,
    ...prompts.filter(
      (prompt) =>
        prompt.projectId === undefined && !overridden.has(prompt.name.toLocaleLowerCase()),
    ),
  ];
}
