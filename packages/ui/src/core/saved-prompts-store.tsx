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

export const savedPromptsStore = createSavedPromptStore({
  getItem: (key) => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
});
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
    try {
      savedPromptsStore.refresh();
    } catch {
      /* 禁用存储时继续展示当前会话。 */
    }
  }
  return () => {
    unsubscribe();
    if (--subscriberCount === 0) window.removeEventListener("storage", onStorage);
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
