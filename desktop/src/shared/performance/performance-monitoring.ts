import {
  applicationPerformanceMetrics,
  PERFORMANCE_MONITORING_ENABLED,
  type PerformanceSnapshot,
} from "./performance-metrics.js";

export function installPerformanceMonitoring(): void {
  if (!PERFORMANCE_MONITORING_ENABLED) return;
  const metrics = applicationPerformanceMetrics;
  Object.defineProperty(window, "__CODEAGENT_PERFORMANCE__", {
    configurable: true,
    value: { snapshot: () => metrics.snapshot(performance.now()) },
  });
  if (!("PerformanceObserver" in window)) return;
  if (!PerformanceObserver.supportedEntryTypes.includes("longtask")) return;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) metrics.recordLongTask(entry.duration);
  });
  observer.observe({ entryTypes: ["longtask"] });
}

declare global {
  interface Window {
    __CODEAGENT_PERFORMANCE__?: Readonly<{ snapshot: () => PerformanceSnapshot }>;
  }
}
