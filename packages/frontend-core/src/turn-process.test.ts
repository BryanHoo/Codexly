import { describe, expect, it } from "vitest";
import { isInlineFileChangeVisible } from "./turn-process.js";

describe("inline file change visibility", () => {
  it.each(["completed", "interrupted", "failed"])(
    "leaves completed file edits to the final summary when the turn is %s",
    (turnStatus) => {
      expect(isInlineFileChangeVisible("completed", turnStatus)).toBe(false);
    },
  );

  it("keeps edits visible while the turn is running", () => {
    for (const status of ["pending", "running", "completed"]) {
      expect(isInlineFileChangeVisible(status, "running")).toBe(true);
    }
    expect(isInlineFileChangeVisible("failed", "running")).toBe(false);
  });
});
