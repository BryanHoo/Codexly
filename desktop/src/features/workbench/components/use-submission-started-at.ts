import { useCallback, useRef, useState } from "react";

// 同步保存渲染时间与事件读取值，避免提交回调捕获过期状态。
export function useSubmissionStartedAt() {
  const [startedAt, setStartedAt] = useState<string>();
  const startedAtRef = useRef<string | undefined>(undefined);
  const beginSubmission = useCallback(() => {
    const nextStartedAt = new Date().toISOString();
    startedAtRef.current = nextStartedAt;
    setStartedAt(nextStartedAt);
  }, []);
  const handleSubmissionStateChange = useCallback((submitting: boolean) => {
    if (submitting) {
      if (startedAtRef.current === undefined) {
        const nextStartedAt = new Date().toISOString();
        startedAtRef.current = nextStartedAt;
        setStartedAt(nextStartedAt);
      }
      return;
    }
    startedAtRef.current = undefined;
    setStartedAt(undefined);
  }, []);
  const getStartedAt = useCallback(() => startedAtRef.current, []);
  return { beginSubmission, getStartedAt, handleSubmissionStateChange, startedAt } as const;
}
