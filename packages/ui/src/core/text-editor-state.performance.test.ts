/// <reference types="node" />
import { memoryUsage } from "node:process";
import { history } from "@codemirror/commands";
import { expect, it } from "vitest";
import { createTextEditorState, TextEditorSession } from "./text-editor-state.js";

it("edits a 2 MiB document with bounded state time and retained heap", () => {
  const source = "a line of source\n".repeat(Math.floor((2 * 1024 * 1024) / 17));
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  gc?.();
  const heapBefore = memoryUsage().heapUsed;
  const started = performance.now();
  let state = createTextEditorState(source, history({ minDepth: 30 }));
  const session = new TextEditorSession(state.doc, "baseline");
  for (let index = 0; index < 1000; index += 1) {
    state = state.update({
      changes: { from: 0, to: 1, insert: index % 2 === 0 ? "b" : "c" },
    }).state;
    expect(session.isDirty(state.doc)).toBe(true);
  }
  const elapsed = performance.now() - started;
  gc?.();
  const retained = memoryUsage().heapUsed - heapBefore;
  // 这是状态更新预算；真实 DOM、移动输入与渲染延迟仍需 CDP / WebView 测量。
  expect(elapsed).toBeLessThan(2000);
  expect(retained).toBeLessThan(48 * 1024 * 1024);
  expect(state.doc.length).toBe(source.length);
  console.info(
    JSON.stringify({
      documentBytes: source.length,
      edits: 1000,
      stateUpdateMs: elapsed,
      retainedHeapBytes: retained,
    }),
  );
});
