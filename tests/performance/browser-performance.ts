import type { CDPSession, Page } from "@playwright/test";

export type ChromiumMetrics = Readonly<Record<string, number>>;

export interface BrowserMeasurement {
  heapDeltaMb: number;
  heapMb: number;
  layoutMs: number;
  listenersDelta: number;
  nodesDelta: number;
  recalcStyleMs: number;
  scriptMs: number;
  taskMs: number;
  totalListeners: number;
  totalNodes: number;
  wallMs: number;
}

export interface RetainedBrowserState {
  domElements: number;
  heapMb: number;
  listeners: number;
  nodes: number;
}

export interface MutationProbeResult {
  batches: number;
  records: number;
}

export interface UserPaintResult extends MutationProbeResult {
  clickToDomMs: number;
  clickToPaintMs: number;
  domToPaintMs: number;
  trustedClick: boolean;
}

export function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export async function readChromiumMetrics(cdp: CDPSession): Promise<ChromiumMetrics> {
  const payload = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(payload.metrics.map((metric) => [metric.name, metric.value]));
}

export async function retainedBrowserState(
  cdp: CDPSession,
  page: Page,
): Promise<RetainedBrowserState> {
  // GC 后的保留状态比导航期间瞬时峰值更适合观察长期增长。
  await cdp.send("HeapProfiler.collectGarbage");
  const metrics = await readChromiumMetrics(cdp);
  return {
    domElements: await page.evaluate(() => document.querySelectorAll("*").length),
    heapMb: roundMetric(requiredMetric(metrics, "JSHeapUsedSize") / 1_048_576),
    listeners: requiredMetric(metrics, "JSEventListeners"),
    nodes: requiredMetric(metrics, "Nodes"),
  };
}

export async function measureBrowserWork<T>(
  cdp: CDPSession,
  action: () => Promise<T>,
): Promise<{ measurement: BrowserMeasurement; value: T }> {
  const before = await readChromiumMetrics(cdp);
  const startedAt = performance.now();
  const value = await action();
  const wallMs = performance.now() - startedAt;
  const after = await readChromiumMetrics(cdp);
  return { measurement: metricDelta(before, after, wallMs), value };
}

export async function startMutationProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = document.querySelector('[role="log"]');
    if (target === null) throw new Error("Timeline mutation probe target is unavailable");
    const probe = { batches: 0, records: 0, observer: undefined as MutationObserver | undefined };
    const observer = new MutationObserver((records) => {
      probe.batches += 1;
      probe.records += records.length;
    });
    probe.observer = observer;
    observer.observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    Reflect.set(globalThis, "__codexlyPerfMutationProbe", probe);
  });
}

export async function stopMutationProbe(page: Page): Promise<MutationProbeResult> {
  return page.evaluate(() => {
    const probe = Reflect.get(globalThis, "__codexlyPerfMutationProbe") as
      { batches: number; observer: MutationObserver; records: number } | undefined;
    if (probe === undefined) throw new Error("Timeline mutation probe was not started");
    probe.observer.disconnect();
    Reflect.deleteProperty(globalThis, "__codexlyPerfMutationProbe");
    return { batches: probe.batches, records: probe.records };
  });
}

export async function startUserPaintProbe(
  page: Page,
  buttonSelector: string,
  marker: string,
): Promise<void> {
  await page.evaluate(
    ({ buttonSelector: selector, marker: expectedMarker }) => {
      const target = document.querySelector('[role="log"]');
      const button = document.querySelector(selector);
      if (target === null || !(button instanceof HTMLButtonElement)) {
        throw new Error("User paint probe targets are unavailable");
      }
      const probe: {
        batches: number;
        clickAt?: number;
        domAt?: number;
        observer?: MutationObserver;
        paintAt?: number;
        records: number;
        trustedClick?: boolean;
      } = { batches: 0, records: 0 };
      const hasMarker = (): boolean => {
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent?.includes(expectedMarker) === true) return true;
        }
        return false;
      };
      const recordDom = (): void => {
        if (probe.clickAt === undefined || probe.domAt !== undefined || !hasMarker()) return;
        probe.domAt = performance.now();
        // 第二帧回调发生在 DOM 插入获得一次渲染机会之后。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            probe.paintAt = performance.now();
            probe.observer?.disconnect();
          });
        });
      };
      const observer = new MutationObserver((records) => {
        if (probe.clickAt === undefined) return;
        probe.batches += 1;
        probe.records += records.length;
        recordDom();
      });
      probe.observer = observer;
      observer.observe(target, { characterData: true, childList: true, subtree: true });
      button.addEventListener(
        "click",
        (event) => {
          probe.clickAt = performance.now();
          probe.trustedClick = event.isTrusted;
          requestAnimationFrame(recordDom);
        },
        { capture: true, once: true },
      );
      Reflect.set(globalThis, "__codexlyPerfUserPaintProbe", probe);
    },
    { buttonSelector, marker },
  );
}

export async function stopUserPaintProbe(page: Page): Promise<UserPaintResult> {
  await page.waitForFunction(
    () => {
      const probe = Reflect.get(globalThis, "__codexlyPerfUserPaintProbe") as
        { paintAt?: number } | undefined;
      return probe?.paintAt !== undefined;
    },
    undefined,
    { timeout: 15_000 },
  );
  return page.evaluate(() => {
    const probe = Reflect.get(globalThis, "__codexlyPerfUserPaintProbe") as
      | {
          batches: number;
          clickAt?: number;
          domAt?: number;
          observer?: MutationObserver;
          paintAt?: number;
          records: number;
          trustedClick?: boolean;
        }
      | undefined;
    probe?.observer?.disconnect();
    Reflect.deleteProperty(globalThis, "__codexlyPerfUserPaintProbe");
    if (
      probe?.clickAt === undefined ||
      probe.domAt === undefined ||
      probe.paintAt === undefined ||
      probe.trustedClick !== true
    ) {
      throw new Error("User paint probe did not observe a trusted click, DOM insertion, and paint");
    }
    return {
      batches: probe.batches,
      clickToDomMs: roundInBrowser(probe.domAt - probe.clickAt),
      clickToPaintMs: roundInBrowser(probe.paintAt - probe.clickAt),
      domToPaintMs: roundInBrowser(probe.paintAt - probe.domAt),
      records: probe.records,
      trustedClick: probe.trustedClick,
    };

    function roundInBrowser(value: number): number {
      return Math.round(value * 1_000) / 1_000;
    }
  });
}

function metricDelta(
  before: ChromiumMetrics,
  after: ChromiumMetrics,
  wallMs: number,
): BrowserMeasurement {
  return {
    heapDeltaMb: roundMetric(
      (requiredMetric(after, "JSHeapUsedSize") - requiredMetric(before, "JSHeapUsedSize")) /
        1_048_576,
    ),
    heapMb: roundMetric(requiredMetric(after, "JSHeapUsedSize") / 1_048_576),
    layoutMs: durationDelta(before, after, "LayoutDuration"),
    listenersDelta:
      requiredMetric(after, "JSEventListeners") - requiredMetric(before, "JSEventListeners"),
    nodesDelta: requiredMetric(after, "Nodes") - requiredMetric(before, "Nodes"),
    recalcStyleMs: durationDelta(before, after, "RecalcStyleDuration"),
    scriptMs: durationDelta(before, after, "ScriptDuration"),
    taskMs: durationDelta(before, after, "TaskDuration"),
    totalListeners: requiredMetric(after, "JSEventListeners"),
    totalNodes: requiredMetric(after, "Nodes"),
    wallMs: roundMetric(wallMs),
  };
}

function durationDelta(before: ChromiumMetrics, after: ChromiumMetrics, name: string): number {
  return roundMetric((requiredMetric(after, name) - requiredMetric(before, name)) * 1_000);
}

function requiredMetric(metrics: ChromiumMetrics, name: string): number {
  const value = metrics[name];
  if (value === undefined) {
    throw new Error(`Chromium performance metric ${name} is unavailable`);
  }
  return value;
}
