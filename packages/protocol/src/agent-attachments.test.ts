import { describe, expect, it } from "vitest";

import { AGENT_FILE_ACCEPT } from "./agent-attachments.js";

describe("agent attachment contract", () => {
  it("allows the file picker to select any ordinary file type", () => {
    expect(AGENT_FILE_ACCEPT).toBe("");
  });
});
