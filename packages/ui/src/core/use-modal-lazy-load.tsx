import { useEffect, useState } from "react";

/** 只在首次打开时挂载懒加载边界；随后保留轻量边界，让原生 Portal 完成关闭动画。
 * 同时覆盖外部受控打开和 Trigger 的非受控打开，不把已关闭弹窗的手势代码拉进首屏。
 */
export function useModalLazyLoad(open: boolean | undefined, defaultOpen: boolean | undefined) {
  const requested = open ?? defaultOpen ?? false;
  const [loaded, setLoaded] = useState(requested);
  useEffect(() => {
    if (open) setLoaded(true);
  }, [open]);
  return [loaded || requested, setLoaded] as const;
}
