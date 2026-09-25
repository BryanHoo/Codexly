import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  McpFormElicitationResolutionSchema,
  McpUrlElicitationResolutionSchema,
} from "./mcp-elicitation.js";

describe("MCP elicitation resolution schema", () => {
  it("requires content only when accepting a form elicitation", () => {
    expect(
      Value.Check(McpFormElicitationResolutionSchema, {
        action: "accept",
        content: { scope: "current" },
      }),
    ).toBe(true);
    expect(Value.Check(McpFormElicitationResolutionSchema, { action: "accept" })).toBe(false);
  });

  it("accepts URL resolution without form content", () => {
    expect(Value.Check(McpUrlElicitationResolutionSchema, { action: "accept" })).toBe(true);
    expect(
      Value.Check(McpUrlElicitationResolutionSchema, { action: "accept", content: {} }),
    ).toBe(false);
  });
});
