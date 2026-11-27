import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  parseCodefreeAuthorization,
  forwardCodefreeAuthorization,
} from "./codefree-authorization.js";
import { AcpRuntime } from "./runtime.js";
import { withStorageCatalog } from "./storage-catalog.test-support.js";

function authorization(state: string): string {
  return `https://www.srdcloud.cn/login/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    redirect_uri: "https://www.srdcloud.cn/login/oauth-srdcloud-redirect",
    state: Buffer.from(state).toString("base64"),
    code_challenge: "fixture",
  }).toString()}`;
}

it.each([false, true])("CodeFree O 草稿握手要求登录（凭据文件存在：%s）", async (hasFile) => {
  const root = await mkdtemp(join(tmpdir(), "acp-codefree-expired-"));
  const engine = "acp-codefree-o";
  const runtime = new AcpRuntime(
    root,
    withStorageCatalog({
      catalog: () => Promise.reject(new Error("Unexpected catalog operation")),
    }),
  );
  try {
    const url = authorization(
      "http://127.0.0.1:4567/oauth2callback?from=codefree-o&randomCode=1234",
    );
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents", `${engine}.json`),
      JSON.stringify({
        engine,
        name: "CodeFree O",
        enabled: true,
        command: process.execPath,
        args: ["-e", `console.error(${JSON.stringify(url)}); process.exitCode = 1`],
        env: { OPENCODE_TEST_HOME: root },
      }),
    );
    if (hasFile) {
      const directory = join(root, ".codefree-o", ".local", "share");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "codefree.json"), "{}");
    }
    const scope = {
      id: "temporary",
      kind: "temporary" as const,
      rootPath: root,
      runtimeWorkspaceRoots: [root],
    };
    const service = runtime.agents[engine];
    if (!service) throw new Error("Missing CodeFree O service");
    await expect(
      service.previewConfig(root, { values: {}, includeCommands: true }, undefined, scope),
    ).rejects.toThrow("ACP_AUTH_REQUIRED");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("仅转交授权码至厂商本次登录公布的环回端口", async () => {
  const request = Promise.withResolvers<URL>();
  const server = createServer((req, res) => {
    request.resolve(new URL(req.url ?? "", "http://127.0.0.1"));
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing listener");
    const callback = `http://127.0.0.1:${String(address.port)}/oauth2callback?from=codefree-o&randomCode=1234`;
    const parsed = parseCodefreeAuthorization(authorization(callback));
    if (!parsed) throw new Error("Missing authorization");
    expect(
      parseCodefreeAuthorization(authorization(callback.replace("127.0.0.1", "example.test"))),
    ).toBeUndefined();
    expect(
      parseCodefreeAuthorization(authorization(callback.replace("oauth2callback", "other"))),
    ).toBeUndefined();
    expect(
      parseCodefreeAuthorization(
        authorization(callback).replace("www.srdcloud.cn", "example.test"),
      ),
    ).toBeUndefined();
    await forwardCodefreeAuthorization(parsed.callback, "fixture-code", AbortSignal.timeout(2000));
    const target = await request.promise;
    expect(target.pathname).toBe("/oauth2callback");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      from: "codefree-o",
      randomCode: "1234",
      code: "fixture-code",
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

it.each(["browser", "code", "browser-then-code", "cancel"] as const)(
  "设置发起 CodeFree O 登录并处理 %s",
  async (route) => {
    const root = await mkdtemp(join(tmpdir(), "acp-codefree-oauth-"));
    const peer = join(root, "peer.mjs");
    const runtime = new AcpRuntime(
      root,
      withStorageCatalog({
        catalog: () => Promise.reject(new Error("Unexpected catalog operation")),
      }),
    );
    const attemptId = "8cf09e48-3919-417e-8b54-bf94c72b0809";
    const engine = "acp-codefree-o";
    const expectedCode = "fixture-code";
    const controller = new AbortController();
    let login: Promise<unknown> | undefined;
    try {
      await writeFile(
        peer,
        `
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
const authFile = join(process.env.OPENCODE_TEST_HOME, ".codefree-o", ".local", "share", "codefree.json");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method } = JSON.parse(line);
  if (method !== "initialize") return;
  const finish = () => console.log(JSON.stringify({ id, jsonrpc: "2.0", result: { protocolVersion: 1, agentInfo: { name: "fixture", version: "1.11.2" } } }));
  if (existsSync(authFile)) return finish();
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/oauth2callback" || url.searchParams.get("randomCode") !== "1234" || url.searchParams.get("code") !== ${JSON.stringify(expectedCode)}) {
      res.writeHead(400).end();
      return;
    }
    mkdirSync(dirname(authFile), { recursive: true });
    writeFileSync(authFile, "{}");
    res.end();
    server.close();
    if (${JSON.stringify(route)} === "browser-then-code") setTimeout(finish, 500);
    else finish();
  });
  server.listen(0, "127.0.0.1", () => {
    const callback = "http://127.0.0.1:" + server.address().port + "/oauth2callback?from=codefree-o&randomCode=1234";
    const url = new URL(${JSON.stringify(authorization("fixture"))});
    url.searchParams.set("state", Buffer.from(callback).toString("base64"));
    process.stderr.write(url.href.slice(0, 25));
    process.stderr.write(url.href.slice(25) + "\\n");
  });
});`,
      );
      const registration = {
        engine: "acp-codefree-o" as const,
        name: "CodeFree O",
        command: process.execPath,
        args: [peer],
        enabled: true,
        env: { OPENCODE_TEST_HOME: root },
      };
      await runtime.catalog.configure(registration);
      await expect(runtime.catalog.command(engine)).rejects.toThrow("启用");
      await expect(runtime.catalog.configure(registration)).rejects.toThrow("请先登录账号");
      const service = runtime.agents[engine];
      if (!service) throw new Error("Missing CodeFree O service");
      const profile = await service.inspect();
      expect(profile.authStatus?.kind).toBe("none");
      login = service.authenticate(
        profile.authMethods[0]?.id ?? "",
        controller.signal,
        undefined,
        attemptId,
      );
      void login.catch(() => undefined);
      const requests = () => service.authElicitation({ attemptId });
      await expect.poll(() => requests().find(({ mode }) => mode === "url")?.mode).toBe("url");
      expect(
        service.authElicitation({ attemptId: "4ca3edb4-e4d8-4f47-9497-5a25af3719b1" }),
      ).toEqual([]);
      const question = requests().find(({ mode }) => mode === "url");
      if (question?.mode !== "url") throw new Error("Missing URL request");
      if (route === "cancel") {
        controller.abort();
        await expect(login).rejects.toThrow();
        expect(requests()).toEqual([]);
        expect((await service.inspect()).authStatus?.kind).toBe("none");
        return;
      }
      expect(question.externalStatus).toBe("opened");
      if (route !== "code") {
        const parsed = parseCodefreeAuthorization(question.url);
        if (!parsed) throw new Error("Missing callback");
        parsed.callback.searchParams.set("code", expectedCode);
        const response = await fetch(parsed.callback);
        expect(response.ok).toBe(true);
        await response.text();
      }
      if (route === "code" || route === "browser-then-code") {
        await expect.poll(() => requests().find((item) => item.mode === "form")).toBeDefined();
        const form = requests().find((item) => item.mode === "form");
        if (!form) throw new Error("Missing code request");
        service.authElicitation({
          attemptId,
          requestId: form.requestId,
          resolution: { action: "accept", content: { code: expectedCode } },
        });
      }
      await expect(login).resolves.toEqual({});
      expect(requests()).toEqual([]);
      expect((await service.inspect()).authStatus?.kind).toBe("account");
      await runtime.catalog.configure(registration);
      await expect(runtime.catalog.command(engine)).resolves.toMatchObject({
        command: process.execPath,
      });
    } finally {
      controller.abort();
      await login?.catch(() => undefined);
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
