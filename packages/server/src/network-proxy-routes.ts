import { appStorageDirectory } from "@codexly/core/app-storage-paths";
import type { FastifyInstance } from "fastify";
import { NetworkProxySettingsSchema, type NetworkProxySettings } from "@codexly/protocol";
import {
  readNetworkProxy,
  saveNetworkProxy,
  testNetworkProxy,
} from "@codexly/provider-acp/network-proxy";

export function registerNetworkProxyRoutes(
  app: FastifyInstance,
  directory = appStorageDirectory(),
) {
  // 沿用应用认证与来源校验；所有响应禁用缓存，错误仅输出固定描述。
  app.get("/v1/network-proxy", async (_request, reply) =>
    reply.header("cache-control", "no-store").send(await readNetworkProxy(directory)),
  );
  app.put<{ Body: NetworkProxySettings }>(
    "/v1/network-proxy",
    { schema: { body: NetworkProxySettingsSchema } },
    async (request, reply) => {
      try {
        return await reply
          .header("cache-control", "no-store")
          .send(await saveNetworkProxy(directory, request.body));
      } catch {
        return await reply.code(400).send({ message: "代理配置保存失败，请检查配置" });
      }
    },
  );
  app.post<{ Body: NetworkProxySettings }>(
    "/v1/network-proxy/test",
    { schema: { body: NetworkProxySettingsSchema } },
    async (request, reply) => {
      try {
        await testNetworkProxy(directory, request.body);
        return { ok: true };
      } catch {
        return await reply.code(400).send({ message: "代理连接测试失败，请检查网关、认证和网络" });
      }
    },
  );
}
