import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  AGENT_FILE_ACCEPT,
  TerminateAgentBackgroundTerminalResponseSchema,
} from "./agent-attachments.js";

describe("agent attachment contract", () => {
  it("allows the file picker to select any ordinary file type", () => {
    expect(AGENT_FILE_ACCEPT).toBe("");
  });

  it("requires the authoritative terminal list after termination", () => {
    const response = {
      status: "terminated",
      terminalId: "terminal-1",
      terminals: { data: [] },
    };
    expect(Value.Check(TerminateAgentBackgroundTerminalResponseSchema, response)).toBe(true);
    expect(
      Value.Check(TerminateAgentBackgroundTerminalResponseSchema, {
        status: "terminated",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
  });
});
