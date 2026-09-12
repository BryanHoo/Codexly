import { describe, expect, it } from "vitest";
import { createWorkspace, openRepository } from "./sqlite-state-repository.test-support.js";

describe("submission persistence", () => {
  it("preserves unknown outcomes across repository restarts and isolates projects", async () => {
    const root = await createWorkspace();
    const repository = await openRepository(root);
    await repository.writeSubmission("temporary", "attempt", {
      fingerprint: "payload",
      stage: "starting",
    });
    await repository.close();
    const reopened = await openRepository(root);
    expect(await reopened.readSubmission("temporary", "attempt")).toEqual({
      fingerprint: "payload",
      stage: "starting",
    });
    expect(await reopened.readSubmission("other", "attempt")).toBeUndefined();
  });
});
