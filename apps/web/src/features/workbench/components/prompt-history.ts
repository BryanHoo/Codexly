import type { AgentItem, AgentSkill, AgentTurn } from "@codexly/protocol";

import type { TaskStoreState } from "../../conversation/runtime/task-store.js";
import {
  normalizePromptSkillContent,
  type PromptSkillContent,
  type PromptSkillContentPart,
} from "./prompt-skill-content.js";

export type PromptHistoryDirection = "next" | "previous";

export function collectPromptHistoryEntries(
  turns: readonly AgentTurn[],
  availableSkills: readonly AgentSkill[],
): readonly PromptSkillContent[] {
  const skillsByName = new Map(availableSkills.map((skill) => [skill.name, skill]));
  const entries: PromptSkillContent[] = [];

  // Snapshot 按时间正序保存 Turn 和 Item；历史导航从最近一次用户输入开始。
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn === undefined) {
      continue;
    }
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      appendPromptHistoryEntry(entries, turn.items[itemIndex], skillsByName);
    }
  }

  return entries;
}

export function collectPromptHistoryEntriesFromTaskStore(
  state: Pick<TaskStoreState, "getItemByKey" | "itemKeysByTurnId" | "turnIds">,
  availableSkills: readonly AgentSkill[],
): readonly PromptSkillContent[] {
  const skillsByName = new Map(availableSkills.map((skill) => [skill.name, skill]));
  const entries: PromptSkillContent[] = [];
  // 直接遍历归一化索引，避免为长历史临时复制完整 Turn 与 Item 数组。
  for (let turnIndex = state.turnIds.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turnId = state.turnIds[turnIndex];
    if (turnId === undefined) {
      continue;
    }
    const itemKeys = state.itemKeysByTurnId[turnId] ?? [];
    for (let itemIndex = itemKeys.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const itemKey = itemKeys[itemIndex];
      appendPromptHistoryEntry(
        entries,
        itemKey === undefined ? undefined : state.getItemByKey(itemKey),
        skillsByName,
      );
    }
  }
  return entries;
}

function appendPromptHistoryEntry(
  entries: PromptSkillContent[],
  item: AgentItem | undefined,
  skillsByName: ReadonlyMap<string, AgentSkill>,
): void {
  if (item?.type !== "message" || item.role !== "user") {
    return;
  }
  const skillReferences = item.skills ?? [];
  if (item.text === "" && skillReferences.length === 0) {
    // 历史附件不能直接重新提交；附件专用输入不生成空白历史项。
    return;
  }

  const parts: PromptSkillContentPart[] = [];
  for (const [index, skillReference] of skillReferences.entries()) {
    const availableSkill = skillsByName.get(skillReference.name);
    parts.push(
      availableSkill === undefined
        ? { text: `$${skillReference.name}`, type: "text" }
        : { skill: availableSkill, type: "skill" },
    );
    if (index < skillReferences.length - 1 || item.text !== "") {
      parts.push({ text: " ", type: "text" });
    }
  }
  if (item.text !== "") {
    parts.push({ text: item.text, type: "text" });
  }
  entries.push(normalizePromptSkillContent(parts));
}

export function resolvePromptHistoryIndex(
  currentIndex: number | null,
  direction: PromptHistoryDirection,
  entryCount: number,
): number | null {
  if (entryCount === 0 || (currentIndex === null && direction === "next")) {
    return null;
  }
  if (currentIndex === null) {
    return 0;
  }
  if (direction === "previous") {
    return Math.min(currentIndex + 1, entryCount - 1);
  }
  return currentIndex === 0 ? null : currentIndex - 1;
}

export function shouldNavigatePromptHistory(
  serializedText: string,
  cursorOffset: number,
  direction: PromptHistoryDirection,
): boolean {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, serializedText.length));
  if (direction === "previous") {
    const firstLineEnd = serializedText.indexOf("\n");
    return firstLineEnd < 0 || boundedOffset <= firstLineEnd;
  }
  const lastLineStart = serializedText.lastIndexOf("\n") + 1;
  return boundedOffset >= lastLineStart;
}
