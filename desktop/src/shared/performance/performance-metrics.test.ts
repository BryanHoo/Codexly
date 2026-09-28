import { describe, expect, it } from "vitest";

import { PerformanceMetrics } from "./performance-metrics.js";

describe("PerformanceMetrics", () => {
  it("summarizes React commits and delta-to-commit latency with stable percentiles", () => {
    const metrics = new PerformanceMetrics();
    for (let value = 1; value <= 100; value += 1) {
      metrics.recordReactCommit(value, 2_000 + value);
    }
    metrics.recordDeltaReceived("project-a:101", 1_950);
    metrics.recordDeltaReceived("project-b:101", 1_975);
    metrics.recordReactCommit(4, 2_000);

    const snapshot = metrics.snapshot(2_000);

    expect(snapshot.reactActualDurationMs).toMatchObject({ count: 101, p50: 50, p95: 95 });
    expect(snapshot.deltaToReactCommitMs).toMatchObject({ count: 2, p50: 25, p95: 50 });
  });

  it("reports rolling IPC throughput, merge rate, queue high water and long tasks", () => {
    const metrics = new PerformanceMetrics();
    metrics.recordIpcEvent(2, 1_100);
    metrics.recordIpcEvent(7, 1_600);
    metrics.recordIpcEvent(3, 2_200);
    metrics.recordIpcMerge(10, 4);
    metrics.recordLongTask(61);
    metrics.recordLongTask(82);

    const snapshot = metrics.snapshot(2_200);

    expect(snapshot.ipc).toEqual({ eventsPerSecond: 2, mergeRate: 0.6, queueHighWatermark: 7 });
    expect(snapshot.longTaskMs).toMatchObject({ count: 2, max: 82, p95: 82 });
  });

  it("reports P95 from native enqueue to WebView receipt", () => {
    const metrics = new PerformanceMetrics();
    for (let latency = 1; latency <= 100; latency += 1) {
      metrics.recordEnqueueToWebView(1_000, 1_000 + latency);
    }
    metrics.recordEnqueueToWebView(1_200, 1_100);

    expect(metrics.snapshot(2_000).enqueueToWebViewMs).toMatchObject({
      count: 100, p50: 50, p95: 95, max: 100,
    });
  });
});
