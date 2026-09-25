import { useEffect, useRef, useState } from "react";
import type { ScheduledTaskPreview, ScheduledTaskSchedule } from "@/protocol/index.js";

export type PreviewSchedule = (schedule: ScheduledTaskSchedule) => Promise<ScheduledTaskPreview>;

export function useSchedulePreview(schedule: ScheduledTaskSchedule | undefined, preview: PreviewSchedule) {
  const [result, setResult] = useState<Readonly<{ key: string; dates?: readonly number[]; failed?: boolean }>>();
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  // 只用调度内容作依赖；名称、提示词与父组件重绘不会重发 IPC。
  const key = JSON.stringify(schedule);
  useEffect(() => {
    if (key === undefined) return;
    const value = JSON.parse(key) as ScheduledTaskSchedule;
    if (value.type === "once") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const request = async () => {
        // 至多一个在途请求；输入持续变化时丢弃过期等待者，只计算最后一份草稿。
        await inFlight.current;
        if (cancelled) return;
        const work = preview(value).then(
          (response) => { if (!cancelled) setResult({ key, dates: response.dates }); },
          () => { if (!cancelled) setResult({ key, failed: true }); },
        );
        inFlight.current = work;
        await work;
      };
      void request();
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, preview, attempt]);
  if (schedule?.type === "once") return { dates: [schedule.atUnixMs], pending: false, failed: false, retry: () => setAttempt((value) => value + 1) };
  const current = result?.key === key ? result : undefined;
  return {
    dates: current?.dates,
    pending: schedule !== undefined && current === undefined,
    failed: current?.failed === true,
    retry: () => { setResult(undefined); setAttempt((value) => value + 1); },
  };
}
