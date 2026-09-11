import { describe, expect, it, vi } from "vitest";

const activity = vi.hoisted(() => ({ active: 0, peak: 0 }));
vi.mock("simple-git", () => ({
  simpleGit: () => ({
    env: () => undefined,
    outputHandler: () => undefined,
    raw: async (args: string[]) => {
      activity.active += 1;
      activity.peak = Math.max(activity.peak, activity.active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (args[0] === "fail") throw new Error("command failed");
        return "ok";
      } finally {
        activity.active -= 1;
      }
    },
  }),
}));

import { createGitCommandExecutor } from "./git-command.js";

describe("Git command shared process queue", () => {
  it("limits distinct executor instances and releases slots after failures", async () => {
    const first = createGitCommandExecutor();
    const second = createGitCommandExecutor();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? first : second)("/repository", [index < 4 ? "fail" : "status"]),
      ),
    );
    expect(activity.peak).toBeLessThanOrEqual(4);
    expect(activity.active).toBe(0);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(8);
  });
});
