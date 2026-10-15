import { expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ProjectRootInputsSchema, ProjectRootsSchema } from "./project-root.js";
it("rejects multiple folders at both write and read protocol boundaries", () => {
  expect(Value.Check(ProjectRootInputsSchema, [{ path: "/one" }, { path: "/two" }])).toBe(false);
  expect(
    Value.Check(ProjectRootsSchema, [
      { id: "a", path: "/one" },
      { id: "b", path: "/two" },
    ]),
  ).toBe(false);
});
