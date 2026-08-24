import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { EventStreamMetricsResponseSchema } from "./server-metrics.js";

const response = {
  projects: [
    {
      activeClients: 1,
      backpressureSignals: 2,
      coalescedEvents: 3,
      pendingDeltas: 0,
      projectId: "codexly",
      providerEventsReceived: 7,
      publishedEvents: 4,
      retainedEvents: 4,
      retentionEvictions: 0,
      slowClientDisconnects: 0,
    },
  ],
  version: 1,
} as const;

describe("Event Stream metrics protocol", () => {
  it("accepts bounded counters and rejects invalid payloads", () => {
    expect(Value.Check(EventStreamMetricsResponseSchema, response)).toBe(true);
    expect(
      Value.Check(EventStreamMetricsResponseSchema, {
        ...response,
        projects: [{ ...response.projects[0], pendingDeltas: -1 }],
      }),
    ).toBe(false);
    expect(Value.Check(EventStreamMetricsResponseSchema, { ...response, extra: true })).toBe(false);
  });
});
