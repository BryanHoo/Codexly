import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { PushProjectCommitsRequestSchema } from "./project-git.js";

it.each(["resolve", "continue", "abort"])("rejects removed conflict action %s", (action) => {
  expect(
    Value.Check(PushProjectCommitsRequestSchema, { expectedSnapshot: "a".repeat(64), action }),
  ).toBe(false);
});
it("keeps supported actions and legacy pushes while rejecting conflict path payloads", () => {
  const request = { expectedSnapshot: "a".repeat(64) };
  expect(Value.Check(PushProjectCommitsRequestSchema, request)).toBe(true);
  for (const action of ["inspect", "push", "publish", "fetch", "integrate", "configure", "branch"])
    expect(Value.Check(PushProjectCommitsRequestSchema, { ...request, action })).toBe(true);
  expect(
    Value.Check(PushProjectCommitsRequestSchema, { ...request, action: "push", paths: ["a.ts"] }),
  ).toBe(false);
});
