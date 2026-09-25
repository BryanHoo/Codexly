import {
  invoke as tauriInvoke,
  type InvokeArgs,
  type InvokeOptions,
} from "@tauri-apps/api/core";

export type NativeInvoke = <T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
) => Promise<T>;

declare global {
  interface Window {
    __CODEAGENT_WEBVIEW_TEST_INVOKE__?: NativeInvoke;
  }
}

export function invoke<T>(command: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  // 测试传输层仅存在于专用构建，生产路径始终调用 Tauri IPC。
  if (import.meta.env.VITE_WEBVIEW_TEST === "1") {
    const testInvoke = window.__CODEAGENT_WEBVIEW_TEST_INVOKE__;
    if (testInvoke !== undefined) {
      if (args === undefined) return testInvoke<T>(command);
      return options === undefined
        ? testInvoke<T>(command, args)
        : testInvoke<T>(command, args, options);
    }
  }
  if (args === undefined) return tauriInvoke<T>(command);
  return options === undefined
    ? tauriInvoke<T>(command, args)
    : tauriInvoke<T>(command, args, options);
}
