import { expect, it } from "vitest";
import { createTaskItemStore } from "./task-store-core.js";
import { eventEnvelope } from "./task-store.test-support.js";

it("keeps bounded text snapshots across append, skipped reads and authoritative replacement", () => {
  const store = createTaskItemStore({
    id: "message",
    role: "assistant",
    text: "initial",
    type: "message",
  });
  const initial = store.readText();
  if (initial === undefined) throw new Error("Expected message text snapshot");
  const append = (delta: string, sequence: number) =>
    store.appendDelta({
      ...eventEnvelope(sequence),
      itemId: "message",
      turnId: "turn",
      type: "message.delta",
      payload: { delta },
    });
  append(" first", 1);
  append(" second", 2);
  const latest = store.readText();
  if (latest === undefined) throw new Error("Expected appended text snapshot");
  expect(latest.chunks).toBe(initial.chunks);
  expect(initial.chunks.slice(0, initial.chunkCount).join("")).toBe("initial");
  expect(latest.chunks.slice(0, latest.chunkCount).join("")).toBe("initial first second");
  expect(store.readText()).toBe(latest);
  expect(store.read()).toMatchObject({ text: "initial first second" });
  store.replace({ id: "message", role: "assistant", text: "final", type: "message" });
  expect(store.readText()?.chunks).not.toBe(latest.chunks);
  expect(store.readText()?.chunks.join("")).toBe("final");
});

it("streams reasoning summaries rather than hidden reasoning content", () => {
  const store = createTaskItemStore({
    id: "reasoning",
    type: "reasoning",
    content: "hidden",
    summary: "first",
  });
  for (const [index, field] of ["content", "summary", "summary"].entries()) {
    store.appendDelta({
      ...eventEnvelope(index + 1),
      itemId: "reasoning",
      turnId: "turn",
      type: "reasoning.delta",
      payload: {
        delta: index === 0 ? " secret" : "next",
        field: field as "content" | "summary",
        sectionIndex: index,
      },
    });
  }
  const snapshot = store.readText();
  if (snapshot === undefined) throw new Error("Expected reasoning summary snapshot");
  const text = snapshot.chunks.slice(0, snapshot.chunkCount).join("");
  expect(text).toBe("first\n\nnext\n\nnext");
  expect(text).toBe(store.readReasoningSummary());
  expect(store.read()).toMatchObject({ content: "hidden secret", summary: text });
});
