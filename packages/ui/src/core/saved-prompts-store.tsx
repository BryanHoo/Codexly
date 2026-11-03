import { createSavedPromptsSync } from "@codexly/frontend-core/saved-prompts-sync";
import type { SavedPromptsRequest, SharedSavedPrompt } from "@codexly/protocol";
import { validateSavedPrompt, type SavedPromptDraft } from "@codexly/frontend-core/saved-prompts";
import { useSyncExternalStore } from "react";
import {
  createSavedPromptStore,
  getSavedPromptCommands,
  selectSavedPromptsForProject,
  SAVED_PROMPTS_STORAGE_KEY,
} from "@codexly/frontend-core/saved-prompts";

import {
  createPromptSuggestion,
  rankPromptSuggestions,
} from "@codexly/frontend-core/prompt-suggestions";
import type { AgentSkill } from "@codexly/protocol";

let remote: ReturnType<typeof createSavedPromptsSync> | undefined;
let memory: string | null = null;
let syncStatus: "ready" | "loading" | "error" = "ready";
const statusListeners = new Set<() => void>();
const setSyncStatus = (status: typeof syncStatus) => {
  if (syncStatus === status) return;
  syncStatus = status;
  for (const listener of statusListeners) listener();
};
export function useSavedPromptsStatus() {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    () => syncStatus,
    () => syncStatus,
  );
}
export const savedPromptsStore = createSavedPromptStore({
  getItem: (key) =>
    remote ? memory : typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (remote) memory = value;
    else window.localStorage.setItem(key, value);
  },
});
/** 平台仅注入传输，管理页与输入框共享唯一快照和迁移流程。 */
export function configureSavedPrompts(
  request: (input: SavedPromptsRequest) => Promise<SharedSavedPrompt[]>,
) {
  if (typeof window === "undefined") return;
  // 浏览器禁用本地存储时仍可直接使用共享存储；旧数据保持原处，不伪造迁移成功。
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* 远端持久化不依赖浏览器存储权限。 */
  }
  const legacyStore = storage ? createSavedPromptStore(storage) : undefined;
  remote = createSavedPromptsSync({
    request,
    readLegacy: () => {
      legacyStore?.refresh();
      return legacyStore?.getSnapshot() ?? [];
    },
    clearLegacy: () => {
      try {
        storage?.removeItem(SAVED_PROMPTS_STORAGE_KEY);
      } catch {
        /* 导入回执已落盘，保留副本也不会重复覆盖。 */
      }
    },
    publish: (prompts) => {
      memory = JSON.stringify({ version: 1, prompts });
      savedPromptsStore.refresh();
    },
  });
  // 首次联网前仍展示旧提示词；共享存储成功返回后才接管可见快照。
  memory = JSON.stringify({ version: 1, prompts: legacyStore?.getSnapshot() ?? [] });
  setSyncStatus("loading");
  savedPromptsStore.refresh();
}
export async function saveSharedPrompt(draft: SavedPromptDraft, id?: string) {
  const invalid = validateSavedPrompt(draft);
  if (invalid) throw new Error(invalid);
  if (!remote) return savedPromptsStore.save(draft, id);
  const prompt = { ...draft, name: draft.name.trim(), id: id ?? crypto.randomUUID() };
  await remote.run({ action: "save", prompt });
  setSyncStatus("ready");
  return prompt;
}
export async function removeSharedPrompt(id: string) {
  if (!remote) {
    savedPromptsStore.remove(id);
    return;
  }
  await remote.run({ action: "remove", id });
  setSyncStatus("ready");
}
export const refreshSavedPrompts = () => {
  if (document.visibilityState === "hidden") return;
  void remote?.refresh().then(
    () => {
      setSyncStatus("ready");
    },
    () => {
      setSyncStatus("error");
    },
  );
};
let subscriberCount = 0;
const onStorage = (event: StorageEvent) => {
  if (event.key !== SAVED_PROMPTS_STORAGE_KEY && event.key !== null) return;
  try {
    savedPromptsStore.refresh();
  } catch {
    /* 保留当前快照，保存操作单独报告存储错误。 */
  }
};
export const subscribeSavedPrompts = (listener: () => void) => {
  const unsubscribe = savedPromptsStore.subscribe(listener);
  // 分屏聊天共用一个系统监听；无订阅者时释放，不增加后台轮询。
  if (subscriberCount++ === 0) {
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refreshSavedPrompts);
    document.addEventListener("visibilitychange", refreshSavedPrompts);
    refreshSavedPrompts();
    try {
      savedPromptsStore.refresh();
    } catch {
      /* 禁用存储时继续展示当前会话。 */
    }
  }
  return () => {
    unsubscribe();
    if (--subscriberCount === 0) {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refreshSavedPrompts);
      document.removeEventListener("visibilitychange", refreshSavedPrompts);
    }
  };
};

export function useSavedPrompts() {
  return useSyncExternalStore(
    subscribeSavedPrompts,
    savedPromptsStore.getSnapshot,
    savedPromptsStore.getSnapshot,
  );
}

type SearchableCommand = Readonly<{ label: string; keywords: readonly string[] }>;
type SavedCommand = ReturnType<typeof getSavedPromptCommands>[number];
type Candidate<T> =
  | { kind: "saved"; item: SavedCommand }
  | { kind: "command"; item: T }
  | { kind: "skill"; item: AgentSkill };
let savedSnapshot: ReturnType<typeof savedPromptsStore.getSnapshot> | undefined;
const projectIndexes = new Map<
  string | undefined,
  ReturnType<typeof createPromptSuggestion<Candidate<never>>>[]
>();
const skillIndexes = new WeakMap<
  readonly AgentSkill[],
  ReturnType<typeof createPromptSuggestion<Candidate<never>>>[]
>();

/** 索引跨分屏复用；正文预览只在提示词变化时截取，不参与按键匹配。 */
export function usePromptSuggestions<T extends SearchableCommand>(
  commands: readonly T[],
  skills: readonly AgentSkill[],
  query: string,
  projectId?: string,
  trigger: "/" | "#" = "/",
) {
  const prompts = useSavedPrompts();
  if (savedSnapshot !== prompts) {
    savedSnapshot = prompts;
    projectIndexes.clear();
  }
  // 按项目惰性构建索引，提示词变更时整体失效；每次按键仅匹配当前项目候选。
  let savedCandidates = projectIndexes.get(projectId);
  if (!savedCandidates) {
    savedCandidates = getSavedPromptCommands(selectSavedPromptsForProject(prompts, projectId)).map(
      (item) => createPromptSuggestion<Candidate<never>>({ kind: "saved", item }, item.keywords),
    );
    // 限制访问过的项目缓存数量，避免长期切换大量项目累计占用内存。
    if (projectIndexes.size >= 16) projectIndexes.delete(projectIndexes.keys().next().value);
    projectIndexes.set(projectId, savedCandidates);
  }
  let skillCandidates = skillIndexes.get(skills);
  if (!skillCandidates) {
    skillCandidates = skills.map((item) =>
      createPromptSuggestion<Candidate<never>>({ kind: "skill", item }, [
        item.name,
        item.displayName,
        item.description,
      ]),
    );
    skillIndexes.set(skills, skillCandidates);
  }
  const commandCandidates = commands.map((item) =>
    createPromptSuggestion<Candidate<T>>({ kind: "command", item }, [item.label, ...item.keywords]),
  );
  const selected = rankPromptSuggestions<Candidate<T>>(
    // 井号入口只查常用提示词，不能插入原生命令或 Skills。
    trigger === "#" ? [savedCandidates] : [savedCandidates, commandCandidates, skillCandidates],
    query,
  );
  const filteredSaved: SavedCommand[] = [];
  const filteredCommands: T[] = [];
  const filteredSkills: AgentSkill[] = [];
  for (const candidate of selected) {
    if (candidate.kind === "skill") filteredSkills.push(candidate.item);
    else if (candidate.kind === "saved") filteredSaved.push(candidate.item);
    else filteredCommands.push(candidate.item);
  }
  // 分组后按视觉顺序重排键盘索引，避免方向键在各组间来回跳动。
  return { filteredCommands: [...filteredSaved, ...filteredCommands], filteredSkills };
}
