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
  it("validates optional diagnostic percentiles and keeps old metrics compatible", () => {
    const diagnostics = { count: 1, p95: 2.5, p99: 3 };
    const extended = {
      ...response,
      eventLoopDelayMs: diagnostics,
      projects: [
        {
          ...response.projects[0],
          queueBytes: 5,
          queueBytesPerBatch: { count: 1, p95: 5, p99: 5 },
          queueWaitMs: diagnostics,
          snapshotRetries: 1,
          snapshotRetriesPerRead: { count: 2, p95: 1, p99: 1 },
        },
      ],
    };
    expect(Value.Check(EventStreamMetricsResponseSchema, extended)).toBe(true);
    expect(
      Value.Check(EventStreamMetricsResponseSchema, {
        ...extended,
        eventLoopDelayMs: { ...diagnostics, p99: -1 },
      }),
    ).toBe(false);
    expect(
      Value.Check(EventStreamMetricsResponseSchema, {
        ...extended,
        projects: [{ ...extended.projects[0], queueBytes: -1 }],
      }),
    ).toBe(false);
  });
});
