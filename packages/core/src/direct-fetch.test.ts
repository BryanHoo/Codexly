import { createServer } from "node:http";
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type buildConnector } from "undici";
import { expect, it, vi } from "vitest";

import { fetchDirect } from "./direct-fetch.js";

it("直连目标服务并保留当前进程的默认连接配置", async () => {
  const server = createServer((_request, response) => response.end("direct"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未绑定 TCP 端口");

  // 默认连接一旦被选用就会失败，用本地响应区分应用请求是否绕开它。
  const connect = vi.fn<ReturnType<typeof buildConnector>>((_options, callback) => {
    callback(new Error("默认连接不可用"), null);
  });
  const dispatcher = new Agent({ connect });
  const previous = getGlobalDispatcher();
  setGlobalDispatcher(dispatcher);
  try {
    const response = await fetchDirect(`http://127.0.0.1:${String(address.port)}/`);
    expect(await response.text()).toBe("direct");
    expect(connect).not.toHaveBeenCalled();
    expect(getGlobalDispatcher()).toBe(dispatcher);
  } finally {
    setGlobalDispatcher(previous);
    await dispatcher.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});
