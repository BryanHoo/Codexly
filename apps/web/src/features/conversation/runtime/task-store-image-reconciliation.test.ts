import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store.js";
import { createResponse, readTurnItemIds, timestamp } from "./task-store.test-support.js";

describe("task store image reconciliation", () => {
  it("reconciles an optimistic image-only message with its authoritative snapshot", () => {
    const liveTurn = {
      completedAt: null,
      error: null,
      id: "turn-running",
      items: [
        {
          attachments: [
            {
              id: "uploaded-image",
              kind: "image" as const,
              mediaType: "image/png" as const,
              name: "diagram.png",
              size: 68,
            },
          ],
          id: "submitted-user-turn-running",
          role: "user" as const,
          text: "",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "running" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [liveTurn] }),
    );

    store.getState().reconcile(
      createResponse({
        turns: [
          {
            ...liveTurn,
            items: [
              {
                attachments: [
                  {
                    id: "historical-image",
                    kind: "image",
                    mediaType: "image/png",
                    name: "图片-1",
                    size: 68,
                  },
                ],
                id: "provider-user-image",
                role: "user",
                text: "",
                type: "message",
              },
            ],
          },
        ],
      }),
    );

    expect(readTurnItemIds(store, "turn-running")).toEqual(["submitted-user-turn-running"]);
    expect(store.getState().getItem("submitted-user-turn-running", "turn-running")).toMatchObject({
      attachments: [{ id: "historical-image", name: "图片-1" }],
    });
  });
});
