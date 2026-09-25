import { Profiler, type ReactNode } from "react";

import {
  applicationPerformanceMetrics,
  PERFORMANCE_MONITORING_ENABLED,
} from "./performance-metrics.js";

type PerformanceProfilerProps = Readonly<{ children: ReactNode }>;

export function PerformanceProfiler({ children }: PerformanceProfilerProps) {
  if (!PERFORMANCE_MONITORING_ENABLED) return children;
  return (
    <Profiler
      id="application"
      onRender={(_id, _phase, actualDuration, _baseDuration, _startTime, commitTime) => {
        // React commitTime 与 performance.timeOrigin 组合后可和 Rust 的 Unix 毫秒时间对齐。
        applicationPerformanceMetrics.recordReactCommit(
          actualDuration,
          performance.timeOrigin + commitTime,
        );
      }}
    >
      {children}
    </Profiler>
  );
}
