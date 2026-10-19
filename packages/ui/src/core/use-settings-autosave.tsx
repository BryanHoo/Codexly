import { useEffect, useRef, useState } from "react";
import {
  createSettingsAutosave,
  type SettingsSaveStatus,
} from "@codexly/frontend-core/settings-autosave";

/** 保存函数读取最新宿主回调，队列保持稳定，卸载时补存尚在防抖窗口内的输入。 */
export function useSettingsAutosave<T>(persist: (value: T) => Promise<void>) {
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const mounted = useRef(true);
  const [status, setStatus] = useState<SettingsSaveStatus>("idle");
  const [queue] = useState(() =>
    createSettingsAutosave<T>(
      (value) => persistRef.current(value),
      (next) => {
        if (mounted.current) setStatus(next);
      },
    ),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void queue.flush();
    };
  }, [queue]);
  return { queue, status };
}
