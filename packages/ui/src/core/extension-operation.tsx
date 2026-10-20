import { useRef, useState } from "react";
import { useMutation, useMutationState, type QueryKey } from "@tanstack/react-query";

/** 只锁定正在操作的扩展；缓存中的进行中操作在切换栏目或虚拟行卸载后仍可追踪。 */
export function useExtensionOperation<Input extends { id: string }, Result>({
  mutationKey,
  mutationFn,
  onSuccess,
}: {
  mutationKey: QueryKey;
  mutationFn: (input: Input) => Promise<Result>;
  onSuccess: (result: Result, input: Input) => void | Promise<void>;
}) {
  const [error, setError] = useState<Error | null>(null);
  const inFlight = useRef(new Set<string>());
  const pending = useMutationState({
    filters: { mutationKey, status: "pending", exact: true },
    select: (mutation) => (mutation.state.variables as Input).id,
  });
  const pendingIds = new Set(pending);
  const mutation = useMutation({
    mutationKey,
    mutationFn,
    onSuccess,
    onMutate: () => {
      setError(null);
    },
    onError: (cause) => {
      setError(cause);
    },
  });
  const run = async (input: Input) => {
    if (inFlight.current.has(input.id) || pendingIds.has(input.id)) return;
    inFlight.current.add(input.id);
    try {
      await mutation.mutateAsync(input);
    } catch {
      // 错误交给界面反馈；同一请求不产生第二个未处理的 Promise 拒绝。
    } finally {
      inFlight.current.delete(input.id);
    }
  };
  return {
    pendingIds,
    run,
    error,
    clearError: () => {
      setError(null);
    },
  };
}
