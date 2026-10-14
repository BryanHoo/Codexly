import { expect, it } from "vitest";
import { readGitReceipt, writeGitReceipt } from "./git-operation-receipt.js";
it("keeps a push failure through reopening and binds it to the committed HEAD", () => {
  const receipt = {
    head: "abc",
    commitSha: "abc",
    pushStatus: "failed",
    failureKind: "authentication",
  } as const;
  const stored = writeGitReceipt(receipt);
  expect(readGitReceipt(stored, "abc")).toEqual(receipt);
  expect(readGitReceipt(stored, "other")).toBeNull();
  expect(readGitReceipt("invalid", "abc")).toBeNull();
});
