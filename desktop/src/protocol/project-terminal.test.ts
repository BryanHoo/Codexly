import { describe, expect, it } from "vitest";

import * as protocol from "./index.js";
import { Value } from "@sinclair/typebox/value";

describe("project terminal protocol", () => {
  it("exports the local terminal frame decoder", () => {
    expect(protocol).toHaveProperty("decodeTerminalFrame");
  });

  it("exports bounded control event and snapshot schemas", () => {
    expect(protocol).toHaveProperty("TerminalControlEventSchema");
    expect(protocol).toHaveProperty("TerminalSnapshotSchema");
  });

  it("preserves u64 offsets and split UTF-8 bytes without copying", () => {
    const buffer = new ArrayBuffer(18);
    const view = new DataView(buffer);
    view.setBigUint64(0, 9007199254740993n, true);
    view.setBigUint64(8, 18446744073709551615n, true);
    new Uint8Array(buffer, 16).set([0xe4, 0xb8]);
    const frame = protocol.decodeTerminalFrame(buffer);
    expect(frame.sequence).toBe(9007199254740993n);
    expect(frame.endOffset).toBe(18446744073709551615n);
    expect(frame.bytes.buffer).toBe(buffer);
    const decoder = new TextDecoder();
    expect(decoder.decode(frame.bytes, { stream: true })).toBe("");
    expect(decoder.decode(new Uint8Array([0xad]))).toBe("中");
  });

  it.each([0, 15, 16, 16401])("rejects invalid frame length %i", (size) => {
    expect(() => protocol.decodeTerminalFrame(new ArrayBuffer(size))).toThrow("TERMINAL_STREAM_INVALID");
  });

  it.each(["01", "-1", "1.0", "18446744073709551616", "1e3", ""]) ("rejects noncanonical offsets %s", (offset) => {
    expect(() => protocol.parseTerminalOffset(offset)).toThrow("TERMINAL_STREAM_INVALID");
  });

  it("encodes scope headers once and rejects control characters", () => {
    const scope = { projectId: "项目%2F", terminalId: "t", generation: "g" };
    expect(protocol.terminalInputHeaders(scope, 1n)).toEqual({
      "x-codeagent-project-id": "%E9%A1%B9%E7%9B%AE%252F",
      "x-codeagent-terminal-id": "t", "x-codeagent-generation": "g", "x-codeagent-input-sequence": "1",
    });
    expect(() => protocol.terminalInputHeaders({ ...scope, terminalId: "\n" }, 1n)).toThrow("TERMINAL_SCOPE_MISMATCH");
  });

  it("validates bounded camelCase metadata", () => {
    const metadata = { projectId: "p", terminalId: "t", generation: "g", rootId: "r", title: "zsh", state: "running", cols: 80, rows: 24, exitCode: null };
    expect(Value.Check(protocol.TerminalMetadataSchema, metadata)).toBe(true);
    expect(Value.Check(protocol.TerminalMetadataSchema, { ...metadata, cols: 501 })).toBe(false);
    expect(Value.Check(protocol.TerminalMetadataSchema, { ...metadata, rootId: undefined, root_id: "r" })).toBe(false);
  });
});
