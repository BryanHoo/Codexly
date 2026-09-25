import { describe, expect, it } from "vitest";

import { NativeCommandError } from "../../platform/tauri/native-client.js";
import { isGitUnavailableError, shouldRetryGitQuery } from "./project-git-error.js";

describe("Git dependency errors", () => {
  it("does not retry when Git is unavailable", () => {
    const error = new NativeCommandError("GIT_NOT_FOUND", "Git is unavailable");

    expect(isGitUnavailableError(error)).toBe(true);
    expect(shouldRetryGitQuery(0, error)).toBe(false);
  });

  it("keeps one retry for transient Git failures", () => {
    expect(shouldRetryGitQuery(0, new Error("temporary failure"))).toBe(true);
    expect(shouldRetryGitQuery(1, new Error("temporary failure"))).toBe(false);
  });
});
