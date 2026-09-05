import { expect, test, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createServerOptions,
  snapshot,
  turnOptions,
  pendingRequest,
} from "./app-all.test-support.js";

test.each(["applied", "targetUnavailable"] as const)(
  "publishes reviewer during a running turn and preserves pending approvals (%s)",
  async (status) => {
    const harness = createProvider();
    const updateTurnApprovalsReviewer = vi.fn(() => Promise.resolve(status));
    harness.provider.updateTurnApprovalsReviewer = updateTurnApprovalsReviewer;
    harness.readTask.mockResolvedValue({
      ...snapshot,
      status: "running",
      pendingRequests: [pendingRequest],
      turns: [
        {
          id: "turn-1",
          status: "running",
          items: [],
          startedAt: null,
          completedAt: null,
          error: null,
        },
      ],
    });
    const repository = createSettingsRepository();
    const app = await createCodexlyServer(
      createServerOptions(harness.provider, { settingsRepository: repository.repository }),
    );
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method: "PUT",
      url: "/v1/projects/codexly/tasks/task-1/settings",
      headers: { "idempotency-key": "live-reviewer" },
      payload: { ...turnOptions, approvalsReviewer: "auto_review" },
    });
    expect(response.statusCode).toBe(200);
    expect(updateTurnApprovalsReviewer).toHaveBeenCalledExactlyOnceWith(
      "task-1",
      "turn-1",
      "auto_review",
    );
    expect(harness.resolvePendingRequest).not.toHaveBeenCalled();
    expect(repository.writeTaskSettings).toHaveBeenCalledOnce();
  },
);
