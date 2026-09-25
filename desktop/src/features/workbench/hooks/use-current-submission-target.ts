import { useCallback, useRef } from "react";

type SubmissionTarget = Readonly<{ projectId: string; taskId: string | undefined }>;

export function useCurrentSubmissionTarget(target: SubmissionTarget) {
  const currentTargetRef = useRef(target);
  currentTargetRef.current = target;
  return useCallback((projectId: string, taskId: string) => {
    const current = currentTargetRef.current;
    return current.projectId === projectId && current.taskId === taskId;
  }, []);
}
