import { useEffect, useRef } from "react";
import { notifyActionError } from "./action-notifications.js";

export function useActionErrorToast(error: Error | null, message: string) {
  const notified = useRef(false);
  useEffect(() => {
    if (error === null) {
      notified.current = false;
      return;
    }
    // 轮询持续失败时只提示一次，成功恢复后下一次失败仍会提示。
    if (notified.current) return;
    notified.current = true;
    notifyActionError(message);
  }, [error, message]);
}
