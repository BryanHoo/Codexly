import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  ProjectRootInputSchema,
  ProjectRootQuerySchema,
  ProjectRootSchema,
  ProjectRootsSchema,
} from "./project-root.js";

describe("project root protocol", () => {
  it("accepts ordered absolute roots and rejects empty, relative, or duplicated roots", () => {
    const roots = [
      { id: "root-primary", path: "/workspace/primary" },
      { id: "root-secondary", path: "/workspace/secondary" },
    ];

    expect(Value.Check(ProjectRootsSchema, roots)).toBe(true);
    expect(Value.Check(ProjectRootsSchema, [])).toBe(false);
    expect(
      Value.Check(ProjectRootsSchema, [{ id: "root-relative", path: "workspace/relative" }]),
    ).toBe(false);
    expect(Value.Check(ProjectRootsSchema, [roots[0], roots[0]])).toBe(false);
    expect(Value.Check(ProjectRootSchema, { path: "/workspace/primary" })).toBe(false);
    expect(Value.Check(ProjectRootSchema, { extra: true, path: "/workspace/primary" })).toBe(false);
  });

  it("keeps root creation input path-only", () => {
    expect(Value.Check(ProjectRootInputSchema, { path: "/workspace/primary" })).toBe(true);
    expect(
      Value.Check(ProjectRootInputSchema, { id: "client-root", path: "/workspace/primary" }),
    ).toBe(false);
  });

  it("requires an absolute root path for public root-scoped requests", () => {
    expect(Value.Check(ProjectRootQuerySchema, { rootPath: "/workspace/primary" })).toBe(true);
    expect(Value.Check(ProjectRootQuerySchema, {})).toBe(false);
    expect(Value.Check(ProjectRootQuerySchema, { rootPath: "workspace/primary" })).toBe(false);
  });
});
