export type SavedPromptDraft = Readonly<{
  name: string;
  shortcut: string;
  content: string;
  projectId?: string;
}>;
export type SavedPrompt = SavedPromptDraft & Readonly<{ id: string }>;
export type SavedPromptError = "name" | "shortcut" | "content" | "duplicate" | "project";
export const SAVED_PROMPTS_STORAGE_KEY = "codexly.saved-prompts.v1";
export const savedPromptLimits = { name: 80, shortcut: 40, content: 20_000 } as const;
type PromptStorage = Pick<Storage, "getItem" | "setItem">;

/** 快捷词支持中文、字母、数字、下划线和连字符，避免与路径及空白触发规则冲突。 */
export function validateSavedPrompt(draft: SavedPromptDraft): SavedPromptError | null {
  if (
    draft.projectId !== undefined &&
    (typeof draft.projectId !== "string" || !draft.projectId.trim())
  )
    return "project";
  if (!draft.name.trim() || draft.name.trim().length > savedPromptLimits.name) return "name";
  if (
    !/^[\p{L}\p{N}_-]+$/u.test(draft.shortcut) ||
    draft.shortcut.length > savedPromptLimits.shortcut
  )
    return "shortcut";
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
    const shortcuts = new Set<string>();
    return data.prompts.filter((entry: unknown): entry is SavedPrompt => {
      if (!entry || typeof entry !== "object") return false;
      const value = entry as SavedPrompt;
      if (
        typeof value.id !== "string" ||
        !value.id ||
        typeof value.name !== "string" ||
        typeof value.shortcut !== "string" ||
        typeof value.content !== "string" ||
        validateSavedPrompt(value)
      )
        return false;
      const shortcut = JSON.stringify([
        value.projectId ?? null,
        value.shortcut.toLocaleLowerCase(),
      ]);
      if (ids.has(value.id) || shortcuts.has(shortcut)) return false;
      ids.add(value.id);
      shortcuts.add(shortcut);
      return true;
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
      if (
        snapshot.some(
          (item) =>
            item.id !== id &&
            item.projectId === draft.projectId &&
            item.shortcut.toLocaleLowerCase() === draft.shortcut.toLocaleLowerCase(),
        )
      )
        throw new Error("duplicate");
      const prompt: SavedPrompt = {
        ...draft,
        name: draft.name.trim(),
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
          JSON.stringify({ version: 1, prompts: snapshot }),
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
    label: `/${prompt.shortcut} · ${prompt.name}`,
    keywords: [prompt.shortcut, prompt.name],
    description: prompt.content.slice(0, 160).replace(/\s+/gu, " "),
    content: prompt.content,
  }));
}

/** 当前项目可使用全局及本项目提示词；同快捷词由项目版本覆盖，其他项目绝不进入候选。 */
export function selectSavedPromptsForProject(prompts: readonly SavedPrompt[], projectId?: string) {
  const scoped = projectId ? prompts.filter((prompt) => prompt.projectId === projectId) : [];
  const overridden = new Set(scoped.map((prompt) => prompt.shortcut.toLocaleLowerCase()));
  return [
    ...scoped,
    ...prompts.filter(
      (prompt) =>
        prompt.projectId === undefined && !overridden.has(prompt.shortcut.toLocaleLowerCase()),
    ),
  ];
}
