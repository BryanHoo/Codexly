import type { ScheduledTask } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ScheduledTaskList } from "./scheduled-task-list.js";

const task: ScheduledTask = {
  createdAtUnixMs: 1,
  enabled: true,
  id: "schedule-a",
  lastRunAtUnixMs: 2,
  lastRunStatus: "failed",
  messageAttachments: [],
  name: "Daily review",
  nextRunAtUnixMs: 2_000_000_000_000,
  projectId: "project-a",
  projectName: "Project A",
  prompt: { attachments: [], skills: [], text: "Review", type: "prompt" },
  runs: [],
  schedule: { atUnixMs: 2_000_000_000_000, type: "once" },
  turnOptions: {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  },
  updatedAtUnixMs: 2,
};

describe("ScheduledTaskList rendering", () => {
  it("renders selection, failure state, search and enable controls", () => {
    const markup = renderToStaticMarkup(
      <ScheduledTaskList
        activeId={task.id}
        loading={false}
        onCreate={vi.fn()}
        onEnabledChange={vi.fn()}
        onSelect={vi.fn()}
        query="Daily"
        setQuery={vi.fn()}
        tasks={[task]}
      />,
    );

    expect(markup).toContain("Daily review");
    expect(markup).toContain("Project A");
    expect(markup).toContain('data-tone="failed"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('role="switch"');
  });
});
