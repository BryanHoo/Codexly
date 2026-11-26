import { acpSubagentItemPrefix, type AgentItem } from "@codexly/protocol";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TaskSnapshotTimeline as WebTimeline } from "../../../apps/web/src/features/workbench/components/task-timeline.js";
import { TaskSnapshotTimeline as DesktopTimeline } from "../../src/features/workbench/components/task-timeline.js";
import "../../src/shared/styles/globals.css";

const childItems = (sessionId: string, title: string, text: string): AgentItem[] => [
  {
    id: acpSubagentItemPrefix(sessionId),
    type: "acp_subagent",
    sessionId,
    parentSessionId: "session",
    title,
  },
  {
    id: acpSubagentItemPrefix(sessionId) + "acp:message:assistant:shared",
    type: "message",
    role: "assistant",
    text,
  },
];

const snapshot = {
  runtime: "acp" as const,
  engine: "codex" as const,
  id: "task",
  projectId: "project",
  title: "",
  pinned: false,
  updatedAt: "2026-11-22T00:00:00Z",
  status: "idle" as const,
  goal: null,
  plan: null,
  contextUsage: null,
  pendingRequests: [],
  turnsNextCursor: null,
  turns: [{
    id: "turn",
    status: "completed" as const,
    error: null,
    startedAt: null,
    completedAt: null,
    items: [
      { id: "answer", type: "message" as const, role: "assistant" as const, text: "根会话答复" },
      ...childItems("first", "第一位审阅者", "第一份审阅结果"),
      ...childItems("second", "第二位审阅者", "第二份审阅结果"),
    ],
  }],
};

it.each([["Web", WebTimeline], ["桌面", DesktopTimeline]] as const)(
  "%s 主时间线仅展示根会话",
  async (_platform, Timeline) => {
    const screen = await render(
      <div style={{ height: 540 }}>
        <Timeline snapshot={snapshot} />
      </div>,
    );
    await expect.element(screen.getByText("根会话答复")).toBeVisible();
    await expect.element(screen.getByText("第一份审阅结果")).not.toBeInTheDocument();
    await expect.element(screen.getByText("第一位审阅者")).not.toBeInTheDocument();
    await expect.element(screen.getByText("第二位审阅者")).not.toBeInTheDocument();
  },
);
