import { describe, expect, it } from "vitest";

import {
  AGENT_FILE_ACCEPT,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_TEXT_BYTES,
} from "./agent-attachments.js";

describe("Codex 0.152 attachment contract", () => {
  it("keeps generated text bounded without restricting path-backed files and images", () => {
    expect(MAX_AGENT_TEXT_BYTES).toBe(1024 * 1024);
    expect(MAX_AGENT_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_IMAGE_BYTES).toBe(512 * 1024 * 1024);
    expect(AGENT_FILE_ACCEPT).toBe("");
  });
});
