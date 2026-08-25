import performanceBudgets from "../performance-budgets.json" with { type: "json" };
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPSession, Page } from "@playwright/test";
import { expect, taskSnapshot, taskSnapshotResponse, test } from "../e2e/fixtures/app-shell.js";
import {
  measureBrowserWork,
  retainedBrowserState,
  roundMetric,
  startMutationProbe,
  startUserPaintProbe,
  stopMutationProbe,
  stopUserPaintProbe,
  type BrowserMeasurement,
  type MutationProbeResult,
  type RetainedBrowserState,
} from "./browser-performance.js";

const timestamp = "2026-08-25T00:00:00.000Z";
const reportPath = join(process.cwd(), ".artifacts", "browser-performance-report.json");
const scenarioResults = new Map<string, object>();
let chromiumVersion = "unknown";

test.afterAll(async () => {
  const scenarios = [...scenarioResults.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, result]) => result);
  if (scenarios.length === 0) throw new Error("Browser performance report has no scenarios");
  const report = {
    environment: {
      arch: process.arch,
      chromium: chromiumVersion,
      ci: Boolean(process.env["CI"]),
      node: process.version,
      platform: process.platform,
    },
    generatedAt: new Date().toISOString(),
    scenarios,
    schemaVersion: 1,
    thresholdsEnforced: false,
  };
  const temporaryPath = `${reportPath}.${String(process.pid)}.tmp`;
  await mkdir(join(process.cwd(), ".artifacts"), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await rename(temporaryPath, reportPath);
});

function createLongHistorySnapshot(): typeof taskSnapshot {
  const { historyItems, historyItemsPerTurn } = performanceBudgets.browserDiagnostics;
  return {
    ...taskSnapshot,
    title: "Browser performance long history",
    turns: Array.from({ length: historyItems / historyItemsPerTurn }, (_, turnIndex) => ({
      completedAt: timestamp,
      error: null,
      id: `browser-history-turn-${String(turnIndex)}`,
      items: Array.from({ length: historyItemsPerTurn }, (_, itemIndex) => ({
        id: `browser-history-message-${String(turnIndex)}-${String(itemIndex)}`,
        role: itemIndex % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `固定浏览器历史 ${String(turnIndex)}:${String(itemIndex)}`,
        type: "message" as const,
      })),
      startedAt: timestamp,
      status: "completed" as const,
    })),
  };
}

test("reports long history browser diagnostics", async ({ page }) => {
  const errors = watchPageErrors(page);
  const snapshot = createLongHistorySnapshot();
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { ...taskSnapshotResponse, snapshot },
    });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const opened = await measureBrowserWork(cdp, async () => {
    await page.goto("/p/codexly/t/task-1", { waitUntil: "load" });
    const conversation = page.getByRole("log", { name: "会话内容" });
    await expect(conversation).toBeVisible();
    await expect.poll(() => page.locator('[aria-label^="Turn "]').count()).toBeGreaterThan(0);
    return page.locator('[aria-label^="Turn "]').count();
  });
  const retained = await retainedBrowserState(cdp, page);

  expect(opened.value).toBeLessThanOrEqual(performanceBudgets.longHistory.maxMountedTurns);
  expect(errors).toEqual([]);
  recordScenario(page, {
    fixture: {
      items: performanceBudgets.browserDiagnostics.historyItems,
      itemsPerTurn: performanceBudgets.browserDiagnostics.historyItemsPerTurn,
    },
    mountedTurns: opened.value,
    navigation: opened.measurement,
    retained,
    scenario: "task-timeline-long-history",
  });
  console.info(
    `BROWSER_PERF_RESULT ${JSON.stringify(scenarioResults.get("task-timeline-long-history"))}`,
  );
});

test("reports 100 turn soak and next message paint", async ({ page }) => {
  const errors = watchPageErrors(page);
  const soakSnapshot = {
    ...taskSnapshot,
    status: "idle" as const,
    title: "Browser performance soak",
    turns: taskSnapshot.turns.slice(0, 1),
  };
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { ...taskSnapshotResponse, snapshot: soakSnapshot },
    });
  });
  await installPerformanceEventStream(page);
  await page.goto("/p/codexly/t/task-1", { waitUntil: "load" });
  await expect(page.getByRole("log", { name: "会话内容" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof Reflect.get(globalThis, "__codexlyPerfEmitEvents")))
    .toBe("function");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const retainedBefore = await retainedBrowserState(cdp, page);
  const checkpoints: { state: RetainedBrowserState; turns: number }[] = [
    { state: retainedBefore, turns: 0 },
  ];
  const turns: {
    measurement: BrowserMeasurement;
    mutations: MutationProbeResult;
    ordinal: number;
  }[] = [];
  let sequence = 0;
  for (let ordinal = 1; ordinal <= performanceBudgets.browserDiagnostics.soakTurns; ordinal += 1) {
    await startMutationProbe(page);
    const result = await measureBrowserWork(cdp, async () => {
      sequence = await emitCompletedTurn(page, ordinal, sequence);
      const marker = `SOAK_ASSISTANT_${String(ordinal)}`;
      await page.getByText(marker, { exact: false }).last().waitFor({ timeout: 15_000 });
    });
    turns.push({
      measurement: result.measurement,
      mutations: await stopMutationProbe(page),
      ordinal,
    });
    if (ordinal % performanceBudgets.browserDiagnostics.checkpointInterval === 0) {
      checkpoints.push({ state: await retainedBrowserState(cdp, page), turns: ordinal });
    }
  }

  const postSoakPaint = await measureNextUserPaint(page, cdp);
  expect(await page.locator('[aria-label^="Turn "]').count()).toBeLessThanOrEqual(
    performanceBudgets.longHistory.maxMountedTurns,
  );
  expect(postSoakPaint.timing.trustedClick).toBe(true);
  expect(errors).toEqual([]);
  recordScenario(page, {
    checkpoints,
    fixture: performanceBudgets.browserDiagnostics,
    postSoakPaint,
    retainedDelta: retainedStateDelta(retainedBefore, checkpoints.at(-1)?.state ?? retainedBefore),
    scenario: "task-timeline-100-turn-soak",
    windows: summarizeTurnWindows(turns, performanceBudgets.browserDiagnostics.checkpointInterval),
  });
  console.info(
    `BROWSER_PERF_RESULT ${JSON.stringify(scenarioResults.get("task-timeline-100-turn-soak"))}`,
  );
});

function recordScenario(
  page: Page,
  result: Readonly<Record<string, unknown> & { scenario: string }>,
): void {
  chromiumVersion = page.context().browser()?.version() ?? chromiumVersion;
  scenarioResults.set(result.scenario, result);
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function installPerformanceEventStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class PerformanceWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        Reflect.set(globalThis, "__codexlyPerfEmitEvents", (events: unknown[]) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ events, type: "events.batch", version: 3 }),
            }),
          );
        });
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: PerformanceWebSocket,
    });
  });
}

async function emitCompletedTurn(
  page: Page,
  ordinal: number,
  previousSequence: number,
): Promise<number> {
  const turnId = `soak-turn-${String(ordinal)}`;
  const userItem = {
    id: `soak-user-${String(ordinal)}`,
    role: "user",
    text: `SOAK_USER_${String(ordinal)}`,
    type: "message",
  } as const;
  const assistantItem = {
    id: `soak-assistant-${String(ordinal)}`,
    role: "assistant",
    text: `SOAK_ASSISTANT_${String(ordinal)} ${"stream payload ".repeat(8)}`,
    type: "message",
  } as const;
  const runningTurn = {
    completedAt: null,
    error: null,
    id: turnId,
    items: [],
    startedAt: timestamp,
    status: "running",
  } as const;
  let sequence = previousSequence;
  const envelope = (event: object): object => ({
    provider: "codex",
    sequence: (sequence += 1),
    sessionId: "e2e-session",
    taskId: "task-1",
    timestamp,
    turnId,
    version: 2,
    ...event,
  });
  const chunks = Array.from(
    { length: performanceBudgets.browserDiagnostics.streamChunksPerTurn },
    (_, index) =>
      assistantItem.text.slice(
        Math.floor(
          (assistantItem.text.length * index) /
            performanceBudgets.browserDiagnostics.streamChunksPerTurn,
        ),
        Math.floor(
          (assistantItem.text.length * (index + 1)) /
            performanceBudgets.browserDiagnostics.streamChunksPerTurn,
        ),
      ),
  );
  const batches = [
    [
      envelope({ payload: { turn: runningTurn }, type: "turn.started" }),
      envelope({ itemId: userItem.id, payload: { item: userItem }, type: "item.completed" }),
    ],
    ...chunks.map((delta) => [
      envelope({ itemId: assistantItem.id, payload: { delta }, type: "message.delta" }),
    ]),
    [
      envelope({
        itemId: assistantItem.id,
        payload: { item: assistantItem },
        type: "item.completed",
      }),
      envelope({
        payload: {
          turn: {
            ...runningTurn,
            completedAt: timestamp,
            items: [userItem, assistantItem],
            status: "completed",
          },
        },
        type: "turn.completed",
      }),
    ],
  ];
  await page.evaluate(async (eventBatches) => {
    const emit = Reflect.get(globalThis, "__codexlyPerfEmitEvents") as
      ((events: unknown[]) => void) | undefined;
    if (emit === undefined) throw new Error("Performance event emitter is unavailable");
    for (const batch of eventBatches) {
      emit(batch);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    }
  }, batches);
  return sequence;
}

async function measureNextUserPaint(
  page: Page,
  cdp: CDPSession,
): Promise<{
  measurement: BrowserMeasurement;
  timing: Awaited<ReturnType<typeof stopUserPaintProbe>>;
}> {
  const marker = "POST_SOAK_USER_PAINT_MARKER";
  await page.route("**/v1/projects/codexly/tasks/task-1/turns", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "post-soak-turn-101",
          items: [],
          startedAt: timestamp,
          status: "running",
        },
      },
      status: 201,
    });
  });
  const prompt = page.getByRole("textbox", { name: "任务输入" });
  const submit = page.getByRole("button", { exact: true, name: "提交" });
  await prompt.fill(marker);
  await expect(submit).toBeEnabled();
  await submit.evaluate((button) => {
    button.setAttribute("data-codexly-perf-submit", "");
  });
  await startUserPaintProbe(page, "[data-codexly-perf-submit]", marker);
  const result = await measureBrowserWork(cdp, async () => {
    await submit.click();
    return stopUserPaintProbe(page);
  });
  return { measurement: result.measurement, timing: result.value };
}

function retainedStateDelta(
  before: RetainedBrowserState,
  after: RetainedBrowserState,
): RetainedBrowserState {
  return {
    domElements: after.domElements - before.domElements,
    heapMb: roundMetric(after.heapMb - before.heapMb),
    listeners: after.listeners - before.listeners,
    nodes: after.nodes - before.nodes,
  };
}

function summarizeTurnWindows(
  turns: readonly {
    measurement: BrowserMeasurement;
    mutations: MutationProbeResult;
    ordinal: number;
  }[],
  windowSize: number,
): object[] {
  const windows: object[] = [];
  for (let start = 0; start < turns.length; start += windowSize) {
    const window = turns.slice(start, start + windowSize);
    windows.push({
      average: {
        layoutMs: average(window.map((turn) => turn.measurement.layoutMs)),
        mutationBatches: average(window.map((turn) => turn.mutations.batches)),
        mutationRecords: average(window.map((turn) => turn.mutations.records)),
        recalcStyleMs: average(window.map((turn) => turn.measurement.recalcStyleMs)),
        scriptMs: average(window.map((turn) => turn.measurement.scriptMs)),
        taskMs: average(window.map((turn) => turn.measurement.taskMs)),
        wallMs: average(window.map((turn) => turn.measurement.wallMs)),
      },
      turns: `${String(window[0]?.ordinal ?? 0)}-${String(window.at(-1)?.ordinal ?? 0)}`,
    });
  }
  return windows;
}

function average(values: readonly number[]): number {
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}
