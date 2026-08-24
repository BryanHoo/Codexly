import type { AgentProviderEvent } from "@codexly/core";
import { describe, expect, it, vi } from "vitest";

import type { PendingCodexRequest } from "./codex-protocol-mapping.js";
import { PendingRequestLifecycle } from "./pending-request-lifecycle.js";

describe("PendingRequestLifecycle", () => {
  it("publishes one terminal event and reuses the same in-flight resolution", async () => {
    const respond = vi.fn(() => Promise.resolve());
    const published: AgentProviderEvent[] = [];
    const publish = (event: AgentProviderEvent) => {
      published.push(event);
    };
    const lifecycle = new PendingRequestLifecycle({ publish, respond });
    const entry: PendingCodexRequest = {
      providerRequestId: 7,
      request: {
        availableDecisions: ["allow", "deny"],
        command: "pnpm test",
        createdAt: "2026-08-02T00:00:00.000Z",
        cwd: null,
        expiresAt: null,
        itemId: "item-1",
        networkAccess: null,
        projectId: "project-1",
        reason: null,
        requestId: "number:7",
        status: "pending",
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      },
    };
    lifecycle.activate(entry);

    const input = {
      itemId: "item-1",
      projectId: "project-1",
      requestId: "number:7",
      resolution: { decision: "allow" as const },
      taskId: "task-1",
      turnId: "turn-1",
      type: "command_approval" as const,
    };
    const first = lifecycle.resolve(input);
    const second = lifecycle.resolve(input);

    await expect(first).resolves.toMatchObject({ status: "resolved" });
    await expect(second).resolves.toMatchObject({ status: "resolved" });
    expect(respond).toHaveBeenCalledTimes(1);
    expect(published.filter((event) => event.type === "pending_request.resolved")).toHaveLength(1);
  });

  it("publishes submitted user input as a user message without exposing secrets", async () => {
    const published: AgentProviderEvent[] = [];
    const lifecycle = new PendingRequestLifecycle({
      publish: (event) => {
        published.push(event);
      },
      respond: vi.fn(() => Promise.resolve()),
    });
    lifecycle.activate({
      providerRequestId: "input-1",
      request: {
        createdAt: "2026-08-02T00:00:00.000Z",
        expiresAt: null,
        itemId: "item-input-1",
        projectId: "project-1",
        questions: [
          {
            header: "模式",
            id: "mode",
            isOther: false,
            isSecret: false,
            options: [{ description: "继续实现", label: "继续" }],
            prompt: "下一步怎么处理？",
            type: "choice",
          },
          {
            header: "密钥",
            id: "token",
            isOther: false,
            isSecret: true,
            options: [],
            prompt: "请输入密钥",
            type: "short_text",
          },
        ],
        requestId: "string:input-1",
        status: "pending",
        taskId: "task-1",
        turnId: "turn-1",
        type: "user_input",
      },
    });

    await lifecycle.resolve({
      itemId: "item-input-1",
      projectId: "project-1",
      requestId: "string:input-1",
      resolution: { answers: { mode: ["继续"], token: ["top-secret"] } },
      taskId: "task-1",
      turnId: "turn-1",
      type: "user_input",
    });

    expect(published.at(-1)).toEqual({
      itemId: "user-input-answer-string:input-1",
      payload: {
        item: {
          id: "user-input-answer-string:input-1",
          role: "user",
          text: "- 模式: 继续\n- 密钥: ******",
          type: "message",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    expect(JSON.stringify(published)).not.toContain("top-secret");
  });
});
