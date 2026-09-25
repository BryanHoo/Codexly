import { Type, type Static } from "@sinclair/typebox";

export const TERMINAL_LIMITS = {
  blockBytes: 16 * 1024,
  outputHighBytes: 256 * 1024,
  outputLowBytes: 64 * 1024,
  inputQueueBytes: 64 * 1024,
  pasteBytes: 1024 * 1024,
  ackBytes: 32 * 1024,
  ackDelayMs: 8,
  scrollback: 3000,
  maxCols: 500,
  maxRows: 200,
  projectSessions: 4,
  globalSessions: 12,
  frameHeaderBytes: 16,
} as const;

const id = Type.String({ minLength: 1, maxLength: 256, pattern: "^[^\\u0000-\\u001f\\u007f]+$" });
export const TerminalScopeSchema = Type.Object({ projectId: id, terminalId: id, generation: id });
export type TerminalScope = Static<typeof TerminalScopeSchema>;
export const TerminalMetadataSchema = Type.Object({
  ...TerminalScopeSchema.properties,
  rootId: id,
  title: Type.String({ maxLength: 128 }),
  state: Type.Union([Type.Literal("running"), Type.Literal("closing"), Type.Literal("exited"), Type.Literal("failed")]),
  cols: Type.Integer({ minimum: 1, maximum: TERMINAL_LIMITS.maxCols }),
  rows: Type.Integer({ minimum: 1, maximum: TERMINAL_LIMITS.maxRows }),
  exitCode: Type.Union([Type.Integer({ minimum: 0, maximum: 4294967295 }), Type.Null()]),
});
export type TerminalMetadata = Static<typeof TerminalMetadataSchema>;
const offsetSchema = Type.String({ pattern: "^(0|[1-9][0-9]{0,19})$", maxLength: 20 });
export const TerminalControlEventSchema = Type.Union([
  Type.Object({ sequence: offsetSchema, type: Type.Union([Type.Literal("created"), Type.Literal("stateChanged")]), data: TerminalMetadataSchema }),
  Type.Object({ sequence: offsetSchema, type: Type.Literal("exited"), data: Type.Object({
    ...TerminalMetadataSchema.properties,
    finalOffset: offsetSchema,
    truncatedReason: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
  }) }),
  Type.Object({ sequence: offsetSchema, type: Type.Literal("removed"), data: TerminalScopeSchema }),
]);
export type TerminalControlEvent = Static<typeof TerminalControlEventSchema>;
export const TerminalSnapshotSchema = Type.Object({ generation: id, sequence: offsetSchema, terminals: Type.Array(TerminalMetadataSchema, { maxItems: 24 }) });
export type TerminalSnapshot = Static<typeof TerminalSnapshotSchema>;
export type CreateTerminalRequest = {
  projectId: string; rootId: string; requestId: string; generation: string; cols: number; rows: number;
};
export const TERMINAL_ERROR_CODES = [
  "TERMINAL_PROJECT_NOT_FOUND", "TERMINAL_ROOT_INVALID", "TERMINAL_LIMIT_REACHED",
  "TERMINAL_NOT_FOUND", "TERMINAL_SCOPE_MISMATCH", "TERMINAL_OWNER_CLOSING",
  "TERMINAL_SPAWN_FAILED", "TERMINAL_INPUT_TOO_LARGE", "TERMINAL_STREAM_INVALID",
  "TERMINAL_CLEANUP_FAILED", "TERMINAL_INPUT_SEQUENCE_GAP", "TERMINAL_INPUT_QUEUE_FULL",
  "TERMINAL_REQUEST_CONFLICT",
] as const;
export type TerminalErrorCode = typeof TERMINAL_ERROR_CODES[number];

export function parseTerminalOffset(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error("TERMINAL_STREAM_INVALID");
  const offset = BigInt(value);
  if (offset > 0xffffffffffffffffn) throw new Error("TERMINAL_STREAM_INVALID");
  return offset;
}

export function decodeTerminalFrame(buffer: ArrayBuffer): { sequence: bigint; endOffset: bigint; bytes: Uint8Array } {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 16 || buffer.byteLength > 16 + TERMINAL_LIMITS.blockBytes) {
    throw new Error("TERMINAL_STREAM_INVALID");
  }
  // u64 始终使用 BigInt；payload 保持视图，避免每帧复制终端输出。
  const view = new DataView(buffer);
  const sequence = view.getBigUint64(0, true);
  const endOffset = view.getBigUint64(8, true);
  const bytes = new Uint8Array(buffer, 16);
  if (sequence === 0n || endOffset < BigInt(bytes.byteLength)) throw new Error("TERMINAL_STREAM_INVALID");
  return { sequence, endOffset, bytes };
}

export function terminalInputHeaders(scope: TerminalScope, sequence: bigint): Record<string, string> {
  if (sequence <= 0n) throw new Error("TERMINAL_STREAM_INVALID");
  parseTerminalOffset(sequence.toString());
  const headers: Record<string, string> = { "x-codeagent-input-sequence": sequence.toString() };
  for (const [key, value] of [["project-id", scope.projectId], ["terminal-id", scope.terminalId], ["generation", scope.generation]]) {
    if (!value || value.length > 256) throw new Error("TERMINAL_SCOPE_MISMATCH");
    for (const char of value) {
      if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) throw new Error("TERMINAL_SCOPE_MISMATCH");
    }
    headers[`x-codeagent-${key}`] = encodeURIComponent(value);
  }
  return headers;
}
