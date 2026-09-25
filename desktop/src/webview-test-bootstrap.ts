import {
  invoke as tauriInvoke,
  type InvokeArgs,
  type InvokeOptions,
} from "@tauri-apps/api/core";

declare global {
  interface Window {
    __CODEAGENT_RUNTIME_CHANNEL__?: { onmessage: (value: unknown) => void };
    __CODEAGENT_WEBVIEW_TEST_BRIDGE__?: {
      calls: Record<string, unknown[]>;
      defaults: Record<string, unknown>;
      handlers: Record<string, (args: InvokeArgs, options?: InvokeOptions) => unknown>;
      once: Record<string, unknown[]>;
      passthrough: Set<string>;
    };
    __CODEAGENT_WEBVIEW_TEST_READY__?: boolean;
  }
}

export async function prepareWebviewTestBridge(): Promise<void> {
  if (import.meta.env.VITE_WEBVIEW_TEST !== "1") return;

  // 先同步发布桥接，让 WebKitGTK 驱动无需等待动态模块加载即可写入测试数据。
  const bridge: NonNullable<Window["__CODEAGENT_WEBVIEW_TEST_BRIDGE__"]> = {
    calls: {},
    defaults: {},
    handlers: {},
    once: {},
    passthrough: new Set(),
  };
  window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__ = bridge;

  // 测试先安装 IPC mock，再放行应用启动，避免首屏请求命中真实本地运行时。
  await import("@wdio/tauri-plugin");
  window.__CODEAGENT_WEBVIEW_TEST_INVOKE__ = async <T>(
    command: string,
    args: InvokeArgs = {},
    options?: InvokeOptions,
  ): Promise<T> => {
    (bridge.calls[command] ??= []).push(args);
    if (bridge.passthrough.has(command)) {
      // 真实链路仅透传显式命令，其他启动查询继续使用隔离 Mock。
      return tauriInvoke<T>(command, args, options);
    }
    if (
      command === "connect_runtime" &&
      !Array.isArray(args) &&
      !(args instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(args) &&
      "onEvent" in args
    ) {
      window.__CODEAGENT_RUNTIME_CHANNEL__ = args.onEvent as NonNullable<
        Window["__CODEAGENT_RUNTIME_CHANNEL__"]
      >;
    }
    const handler = bridge.handlers[command];
    if (handler !== undefined) return handler(args, options) as T;
    const once = bridge.once[command];
    if (once !== undefined && once.length > 0) return once.shift() as T;
    if (command in bridge.defaults) return bridge.defaults[command] as T;
    throw new Error(`Missing WebView test response for ${command}`);
  };
  await new Promise<void>((resolve) => {
    const waitUntilReady = () => {
      if (window.__CODEAGENT_WEBVIEW_TEST_READY__ === true) {
        resolve();
        return;
      }
      window.setTimeout(waitUntilReady, 10);
    };
    waitUntilReady();
  });
}
