import { expect, test } from "@playwright/test";

type SourceOpenSample = Readonly<{
  actualDurationMs: number;
  domNodes: number;
  longestTaskMs: number;
  openDurationMs: number;
}>;

type SourceBenchmarkWindow = Window &
  typeof globalThis & {
    runSourceBenchmark: (bytes: number) => Promise<SourceOpenSample>;
  };

const CASES = [
  { bytes: 256 * 1_024, maxDomNodes: 350, maxLongestTaskMs: 100, maxOpenP95Ms: 120 },
  { bytes: 2 * 1_024 * 1_024, maxDomNodes: 350, maxLongestTaskMs: 180, maxOpenP95Ms: 300 },
] as const;

function percentile(values: readonly number[], ratio: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)] ?? 0;
}

for (const benchmarkCase of CASES) {
  test(`${String(benchmarkCase.bytes)} byte source open baseline`, async ({ page }) => {
    await page.goto("/benchmarks/source-open/index.html");
    const samples: SourceOpenSample[] = [];
    for (let iteration = 0; iteration < 10; iteration += 1) {
      samples.push(
        await page.evaluate(
          (bytes) => (window as SourceBenchmarkWindow).runSourceBenchmark(bytes),
          benchmarkCase.bytes,
        ),
      );
    }
    const result = {
      actualDurationP95Ms: percentile(
        samples.map((sample) => sample.actualDurationMs),
        0.95,
      ),
      bytes: benchmarkCase.bytes,
      domNodes: Math.max(...samples.map((sample) => sample.domNodes)),
      longestTaskMs: Math.max(...samples.map((sample) => sample.longestTaskMs)),
      openP50Ms: percentile(
        samples.map((sample) => sample.openDurationMs),
        0.5,
      ),
      openP95Ms: percentile(
        samples.map((sample) => sample.openDurationMs),
        0.95,
      ),
    };
    console.log(`PERFORMANCE_BASELINE ${JSON.stringify(result)}`);

    expect(result.domNodes).toBeLessThanOrEqual(benchmarkCase.maxDomNodes);
    expect(result.longestTaskMs).toBeLessThanOrEqual(benchmarkCase.maxLongestTaskMs);
    expect(result.openP95Ms).toBeLessThanOrEqual(benchmarkCase.maxOpenP95Ms);
  });
}
