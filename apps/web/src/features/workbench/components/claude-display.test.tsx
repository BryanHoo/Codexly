import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContextUsageSummary } from "@codexly/ui/core/context-usage-summary";
import { EmbeddedSubagentOutput } from "@codexly/ui/core/embedded-subagent-output";
import { createTaskItemStore } from "../../conversation/runtime/task-store.js";
import { collectSubagents } from "./subagent.js";
import { snapshot } from "./task-timeline.test-support.js";

it("shows known context and preserves unknown windows without inventing a percentage", () => {
  const known = renderToStaticMarkup(
    <ContextUsageSummary
      usage={{ usedTokens: 50000, contextWindow: 200000 }}
      label="上下文用量"
      unknownLabel="窗口未知"
    />,
  );
  expect(known).toContain('aria-valuenow="25"');
  expect(known).toContain("50,000 / 200,000");
  const unknown = renderToStaticMarkup(
    <ContextUsageSummary
      usage={{ usedTokens: 42, contextWindow: null }}
      label="上下文用量"
      unknownLabel="窗口未知"
    />,
  );
  expect(unknown).toContain("窗口未知");
  expect(unknown).not.toContain('role="meter"');
});

it("opens Claude transcript data from the parent item without requesting a fake task", () => {
  const item = {
    id: "spawn",
    type: "tool" as const,
    name: "agent/spawn",
    status: "completed" as const,
    output: {
      parentTaskId: "parent",
      agents: [{ taskId: "spawn", nickname: "检查组件", status: "completed" }],
      turn: {
        id: "child-turn",
        status: "completed",
        startedAt: null,
        completedAt: null,
        error: null,
        items: [{ id: "child-text", type: "message", role: "assistant", text: "组件检查结果" }],
      },
    },
  };
  const baseTurn = snapshot.turns[0];
  if (!baseTurn) throw new Error("Missing turn fixture");
  const agents = collectSubagents({ ...snapshot, turns: [{ ...baseTurn, items: [item] }] });
  expect(agents[0]?.embedded).toEqual({ parentTaskId: "parent", itemId: "spawn" });
  const markup = renderToStaticMarkup(
    <EmbeddedSubagentOutput
      loadOlderLabel="加载更早记录"
      store={createTaskItemStore(item)}
      renderItem={(child) => (child.type === "message" ? <p>{child.text}</p> : null)}
    />,
  );
  expect(markup).toContain("组件检查结果");
});

it("limits initially mounted subagent records while keeping earlier output available", () => {
  const item = {
    id: "spawn",
    type: "tool" as const,
    name: "agent/spawn",
    status: "completed" as const,
    output: {
      parentTaskId: "parent",
      turn: {
        id: "child",
        items: Array.from({ length: 120 }, (_, index) => ({
          id: String(index),
          type: "message",
          role: "assistant",
          text: `record-${String(index)}`,
        })),
      },
    },
  };
  const markup = renderToStaticMarkup(
    <EmbeddedSubagentOutput
      store={createTaskItemStore(item)}
      loadOlderLabel="加载更早记录"
      renderItem={(child) => <p data-record="">{child.id}</p>}
    />,
  );
  expect(markup.match(/data-record/gu)).toHaveLength(50);
  expect(markup).toContain("加载更早记录");
});
