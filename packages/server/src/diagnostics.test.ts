import { describe, expect, it } from "vitest";
import { DiagnosticLogBuffer } from "./diagnostics.js";

describe("diagnostic log buffer", () => {
  it("keeps only bounded structured fields and evicts oldest records", () => {
    const buffer = new DiagnosticLogBuffer(200, 2);
    buffer.write(
      JSON.stringify({
        level: 50,
        time: 1,
        msg: "secret",
        req: { headers: { cookie: "secret" } },
        errorCode: "INTERNAL_ERROR",
      }),
    );
    expect(buffer.snapshot().logs.join("")).not.toContain("secret");
    buffer.write(JSON.stringify({ level: 40, time: 2 }));
    buffer.write(JSON.stringify({ level: 40, time: 3 }));
    const snapshot = buffer.snapshot();
    expect(snapshot.logs.map((line) => (JSON.parse(line) as { time: number }).time)).toEqual([
      2, 3,
    ]);
    expect(snapshot.droppedEntries).toBe(1);
    buffer.write("not json");
    buffer.write("x".repeat(20_000));
    expect(buffer.snapshot().logs).toEqual(snapshot.logs);
  });

  it("applies a byte budget, isolates snapshots and clears retained data", () => {
    const buffer = new DiagnosticLogBuffer(60, 100);
    for (let time = 0; time < 10; time++) buffer.write(JSON.stringify({ level: 40, time }));
    const snapshot = buffer.snapshot();
    expect(Buffer.byteLength(snapshot.logs.join(""))).toBeLessThanOrEqual(60);
    expect(snapshot.logs.length).toBeLessThan(10);
    snapshot.logs.push("mutated");
    expect(buffer.snapshot().logs).not.toContain("mutated");
    buffer.clear();
    expect(buffer.snapshot()).toEqual({ logs: [], droppedEntries: 0 });
  });
});

it("preserves provider diagnostic codes without retaining message text", () => {
  const buffer = new DiagnosticLogBuffer();
  buffer.write(
    JSON.stringify({
      level: 40,
      component: "provider-codex",
      diagnosticCode: "thread_unsubscribe_failed",
      msg: "private message",
    }),
  );
  expect(JSON.parse(buffer.snapshot().logs[0] ?? "{}")).toMatchObject({
    diagnosticCode: "thread_unsubscribe_failed",
  });
  expect(buffer.snapshot().logs.join("")).not.toContain("private message");
});
