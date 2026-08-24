import { mapCodexNotification } from "./codex-protocol-mapping.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export const mapNotification = (method: string, params: unknown) =>
  mapCodexNotification(
    method,
    params,
    () => undefined,
    () => undefined,
  );
