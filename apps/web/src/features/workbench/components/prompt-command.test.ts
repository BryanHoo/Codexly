import { describe, expect, it } from "vitest";

import {
  filterPromptCommandItems,
  filterPromptSkills,
  getPromptCommandItems,
  getPromptCommandAvailability,
  movePromptCommandSelection,
  resolvePromptFileMention,
  resolvePromptSlashCommand,
} from "./prompt-command.js";

const promptCommandItems = getPromptCommandItems();
const temporaryPromptCommandItems = getPromptCommandItems({ projectToolsEnabled: false });

const commandItems = [
  {
    action: "initialize",
    description: "创建包含 Codex 说明的 AGENTS.md 文件",
    id: "initialize",
    keywords: ["init", "初始化"],
    label: "初始化",
  },
  {
    action: "review",
    description: "审查未暂存的更改，或与某个分支进行比较",
    id: "review-code",
    keywords: ["review", "审查"],
    label: "代码审查",
  },
] as const;

const skills = [
  {
    description: "审查认证、授权和敏感数据边界",
    displayName: "Security review",
    id: "skill-security",
    name: "review-security",
    scope: "system" as const,
  },
  {
    description: "撰写 Diataxis 项目文档",
    displayName: "Documentation writer",
    id: "skill-docs",
    name: "documentation-writer",
    scope: "user" as const,
  },
];

function findCommand(action: (typeof promptCommandItems)[number]["action"]) {
  const command = promptCommandItems.find((item) => item.action === action);
  if (command === undefined) {
    throw new Error(`Missing prompt command: ${action}`);
  }
  return command;
}

describe("prompt slash command", () => {
  it("resolves file mentions at the start or after whitespace", () => {
    expect(resolvePromptFileMention("@", 1)).toEqual({ end: 1, query: "", start: 0 });
    expect(resolvePromptFileMention("@index", 6)).toEqual({ end: 6, query: "index", start: 0 });
    expect(resolvePromptFileMention("说明 @main.ts", 11)).toEqual({
      end: 11,
      query: "main.ts",
      start: 3,
    });
    expect(resolvePromptFileMention("说明\n@src/", 8)).toEqual({
      end: 8,
      query: "src/",
      start: 3,
    });
  });

  it("rejects file mentions attached to text or containing whitespace", () => {
    expect(resolvePromptFileMention("说明@index", 8)).toBeNull();
    expect(resolvePromptFileMention("@index 后续", 9)).toBeNull();
    expect(resolvePromptFileMention("说明 @index", 2)).toBeNull();
  });

  it("resolves slash tokens at the start or after whitespace", () => {
    expect(resolvePromptSlashCommand("/", 1)).toEqual({ end: 1, query: "", start: 0 });
    expect(resolvePromptSlashCommand("/项目", 3)).toEqual({ end: 3, query: "项目", start: 0 });
    expect(resolvePromptSlashCommand(" /项目", 4)).toEqual({ end: 4, query: "项目", start: 1 });
    expect(resolvePromptSlashCommand("说明 /项目", 6)).toEqual({ end: 6, query: "项目", start: 3 });
    expect(resolvePromptSlashCommand("说明\n/项目", 6)).toEqual({
      end: 6,
      query: "项目",
      start: 3,
    });
  });

  it("rejects slash tokens attached to preceding text or containing whitespace", () => {
    expect(resolvePromptSlashCommand("说明/项目", 5)).toBeNull();
    expect(resolvePromptSlashCommand("/项目 后续说明", 7)).toBeNull();
    expect(resolvePromptSlashCommand("说明 /项目", 2)).toBeNull();
  });

  it("filters commands by labels and localized keywords", () => {
    expect(filterPromptCommandItems(commandItems, "初始化")).toEqual([commandItems[0]]);
    expect(filterPromptCommandItems(commandItems, "review")).toEqual([commandItems[1]]);
    expect(filterPromptCommandItems(commandItems, "missing")).toEqual([]);
  });

  it("filters Codex skills by display name, native name, and description", () => {
    expect(filterPromptSkills(skills, "Security")).toEqual([skills[0]]);
    expect(filterPromptSkills(skills, "documentation-writer")).toEqual([skills[1]]);
    expect(filterPromptSkills(skills, "认证")).toEqual([skills[0]]);
  });

  it("wraps keyboard selection while keeping empty lists stable", () => {
    expect(movePromptCommandSelection(0, 1, 2)).toBe(1);
    expect(movePromptCommandSelection(1, 1, 2)).toBe(0);
    expect(movePromptCommandSelection(0, -1, 2)).toBe(1);
    expect(movePromptCommandSelection(4, 1, 0)).toBe(0);
  });

  it("lists the official task commands with descriptions", () => {
    expect(promptCommandItems.map((item) => item.label)).toEqual([
      "代码审查",
      "初始化",
      "压缩",
      "复制",
      "计划",
      "目标",
    ]);
    expect(promptCommandItems.every((item) => item.description.length > 0)).toBe(true);
  });

  it("omits project-only commands for temporary tasks", () => {
    expect(temporaryPromptCommandItems.map((item) => item.label)).toEqual([
      "压缩",
      "复制",
      "计划",
      "目标",
    ]);
  });

  it("derives task command availability from task context and capabilities", () => {
    const capabilities = {
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    };
    const review = findCommand("review");
    const initialize = findCommand("initialize");
    const plan = findCommand("plan");
    const goal = findCommand("goal");

    expect(getPromptCommandAvailability(review, capabilities, true)).toEqual({
      available: true,
    });
    expect(getPromptCommandAvailability(review, capabilities, false)).toEqual({
      available: true,
    });
    expect(getPromptCommandAvailability(initialize, capabilities, false)).toEqual({
      available: true,
    });
    expect(getPromptCommandAvailability(plan, capabilities, false)).toEqual({ available: true });
    expect(getPromptCommandAvailability(goal, capabilities, false)).toEqual({ available: true });
    expect(
      getPromptCommandAvailability(
        review,
        { ...capabilities, turns: { ...capabilities.turns, review: false } },
        true,
      ),
    ).toEqual({ available: false, reason: "当前运行时不支持此命令" });
  });
});
