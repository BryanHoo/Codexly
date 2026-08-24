import type { AgentSkill, AgentTurn } from "@codexly/protocol";
import { describe, expect, it } from "vitest";

import { serializePromptSkillContent } from "./prompt-skill-content.js";
import {
  collectPromptHistoryEntries,
  resolvePromptHistoryIndex,
  shouldNavigatePromptHistory,
} from "./prompt-history.js";

const skill: AgentSkill = {
  description: "审查界面",
  displayName: "Frontend design",
  id: "skill-frontend-design",
  name: "frontend-design",
  scope: "system",
};

function createTurn(id: string, items: AgentTurn["items"]): AgentTurn {
  return {
    completedAt: "2026-08-10T08:01:00.000Z",
    error: null,
    id,
    items,
    startedAt: "2026-08-10T08:00:00.000Z",
    status: "completed",
  };
}

describe("prompt history", () => {
  it("collects user inputs newest-first and restores available Skill tokens", () => {
    const turns = [
      createTurn("turn-1", [
        { id: "user-1", role: "user", text: "第一次输入", type: "message" },
        { id: "assistant-1", role: "assistant", text: "回复", type: "message" },
      ]),
      createTurn("turn-2", [
        {
          id: "user-2",
          role: "user",
          skills: [{ name: "frontend-design" }, { name: "removed-skill" }],
          text: "第二次输入",
          type: "message",
        },
        {
          attachments: [
            {
              id: "attachment-1",
              kind: "image",
              mediaType: "image/png",
              name: "image.png",
              size: 68,
            },
          ],
          id: "user-attachment-only",
          role: "user",
          text: "",
          type: "message",
        },
      ]),
    ];

    const entries = collectPromptHistoryEntries(turns, [skill]);

    expect(entries).toHaveLength(2);
    expect(serializePromptSkillContent(entries[0] ?? [])).toBe(
      "$frontend-design $removed-skill 第二次输入",
    );
    expect(serializePromptSkillContent(entries[1] ?? [])).toBe("第一次输入");
  });

  it("moves within history bounds and exits after the newest entry", () => {
    expect(resolvePromptHistoryIndex(null, "previous", 3)).toBe(0);
    expect(resolvePromptHistoryIndex(0, "previous", 3)).toBe(1);
    expect(resolvePromptHistoryIndex(2, "previous", 3)).toBe(2);
    expect(resolvePromptHistoryIndex(2, "next", 3)).toBe(1);
    expect(resolvePromptHistoryIndex(0, "next", 3)).toBeNull();
    expect(resolvePromptHistoryIndex(null, "next", 3)).toBeNull();
    expect(resolvePromptHistoryIndex(null, "previous", 0)).toBeNull();
  });

  it("only navigates multiline history from the first or last input line", () => {
    const text = "第一行\n第二行\n第三行";

    expect(shouldNavigatePromptHistory(text, 2, "previous")).toBe(true);
    expect(shouldNavigatePromptHistory(text, 6, "previous")).toBe(false);
    expect(shouldNavigatePromptHistory(text, 8, "next")).toBe(true);
    expect(shouldNavigatePromptHistory(text, text.length, "next")).toBe(true);
    expect(shouldNavigatePromptHistory(text, 0, "next")).toBe(false);
  });
});
