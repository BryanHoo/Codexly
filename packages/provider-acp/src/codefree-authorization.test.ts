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
    // 测试替身只实现 serve 的健康与认证接口；若误走厂商 ACP 子命令，启动立即失败。
    const fixture = join(root, "cli.cjs");
    await writeFile(
      fixture,
      `if(process.argv[2]!=="serve") process.exit(1);
const server=require("node:http").createServer((req,res)=>{
  res.setHeader("content-type","application/json");
  res.end(JSON.stringify(req.url.startsWith("/global/health")?{version:"test"}:{authenticated:false}));
});
server.listen(0,"127.0.0.1",()=>console.log("server listening on http://127.0.0.1:"+server.address().port));`,
    );
    await mkdir(join(root, "agents"));
    await writeFile(
      join(root, "agents", `${engine}.json`),
      JSON.stringify({
        engine,
        name: "CodeFree O",
        enabled: true,
        command: process.execPath,
        args: [fixture, "acp"],
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
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
if (process.argv[2] !== "serve") process.exit(1);
const authFile = join(process.env.OPENCODE_TEST_HOME, ".codefree-o", ".local", "share", "codefree.json");
let authUrl;
let confirmed = existsSync(authFile);
const api = createServer(async (req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  res.setHeader("content-type","application/json");
  if(path === "/global/health") return res.end(JSON.stringify({version:"1.11.2"}));
  if(path === "/codefree/auth/login") {
    const callback = createServer((req,res)=>{
      const url = new URL(req.url,"http://127.0.0.1");
      if(url.pathname!=="/oauth2callback" || url.searchParams.get("code")!==${JSON.stringify(expectedCode)}){
        res.writeHead(400).end(); return;
      }
      mkdirSync(dirname(authFile),{recursive:true});
      writeFileSync(authFile,"{}");
      res.end();
      callback.close();
      setTimeout(()=>{confirmed=true;},${JSON.stringify(route)}==="browser-then-code"?500:0);
    });
    await new Promise(resolve=>callback.listen(0,"127.0.0.1",resolve));
    const url = new URL(${JSON.stringify(authorization("fixture"))});
    url.searchParams.set("state",Buffer.from("http://127.0.0.1:"+callback.address().port+"/oauth2callback?from=codefree-o&randomCode=1234").toString("base64"));
    authUrl=url.href;
  }
  res.end(JSON.stringify({authenticated:confirmed,login:{state:authUrl?"running":"idle",authUrl}}));
});
api.listen(0,"127.0.0.1",()=>console.log("server listening on http://127.0.0.1:"+api.address().port));`,
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
