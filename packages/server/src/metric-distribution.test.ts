import { expect, it } from "vitest";
import { MetricDistribution } from "./metric-distribution.js";

it("reports numeric tail percentiles and ages out old spikes within bounded memory", () => {
  const distribution = new MetricDistribution();
  expect(distribution.metrics).toEqual({ count: 0, p95: 0, p99: 0 });
  for (let value = 1; value <= 100; value++) distribution.record(value);
  expect(distribution.metrics).toEqual({ count: 100, p95: 95, p99: 99 });
  for (let value = 0; value < 1024; value++) distribution.record(2);
  distribution.record(Number.NaN);
  distribution.record(Number.POSITIVE_INFINITY);
  distribution.record(-1);
  expect(distribution.metrics).toEqual({ count: 1124, p95: 2, p99: 2 });
});
