import { stat } from "node:fs/promises";
import { get } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AcpAgentProfile } from "@codexly/protocol";
import type { AcpAgentLaunchOptions, AcpAgentLauncher } from "./agent-launcher.js";
import type { AcpElicitations } from "./elicitation.js";

export const CODEFREE_ENGINE = "acp-codefree-o";
export const CODEFREE_LOGIN = "codefree-browser";
const ORIGIN = "https://www.srdcloud.cn";
const LOGIN_TIMEOUT_MS = 135_000;
const CALLBACK_CONFIRMATION_MS = 30_000;
const method = { id: CODEFREE_LOGIN, name: "CodeFree O" };

export const codefreeSignedOutProfile: AcpAgentProfile = {
  engine: CODEFREE_ENGINE,
  protocolVersion: 1,
  agentInfo: { name: "CodeFree O", version: "" },
  authStatus: { kind: "none", label: "CodeFree O" },
  authMethods: [method],
};

export async function codefreeCredentialRevision(
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  // 只读取文件元数据。一旦授权文件更新，原有握手和模型快照都需要重新验证。
  const path = join(
    env["OPENCODE_TEST_HOME"] ?? homedir(),
    ".codefree-o",
    ".local",
    "share",
    "codefree.json",
  );
  const file = await stat(path).catch(() => undefined);
  return file?.isFile() ? JSON.stringify([path, file.ino, file.ctimeMs, file.size]) : undefined;
}

export function parseCodefreeAuthorization(
  line: string,
): { url: string; callback: URL } | undefined {
  const candidate = /https:\/\/www\.srdcloud\.cn\/login\/oauth\/authorize\?[^\s"']{1,4096}/.exec(
    line.replaceAll("\u001b", " "),
  )?.[0];
  if (!candidate) return;
  const url = new URL(candidate);
  const state = url.searchParams.get("state");
  if (
    url.searchParams.get("response_type") !== "code" ||
    url.searchParams.get("redirect_uri") !== `${ORIGIN}/login/oauth-srdcloud-redirect` ||
    !url.searchParams.get("code_challenge") ||
    !state ||
    !/^[A-Za-z0-9+/_=-]{1,2048}$/.test(state)
  )
    return;
  let callback: URL;
  try {
    callback = new URL(Buffer.from(state, "base64").toString("utf8"));
  } catch {
    return;
  }
  // 回调只取自本次子进程的 OAuth state，禁止界面提交主机、端口或路径。
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    !callback.port ||
    callback.username ||
    callback.password ||
    callback.hash ||
    callback.pathname !== "/oauth2callback" ||
    callback.searchParams.size !== 2 ||
    callback.searchParams.get("from") !== "codefree-o" ||
    !/^\d{4}$/.test(callback.searchParams.get("randomCode") ?? "")
  )
    return;
  return { url: url.href, callback };
}

export function forwardCodefreeAuthorization(
  callback: URL,
  value: string,
  signal: AbortSignal,
): Promise<void> {
  const code = value.trim();
  if (!/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(code))
    return Promise.reject(new Error("CodeFree O 授权码格式无效"));
  const target = new URL(callback);
  target.searchParams.set("code", code);
  // 与浏览器回调一致，只发出一次环回请求，不跟随重定向或记录授权码。
  return new Promise((resolve, reject) => {
    const request = get(
      target,
      {
        agent: false,
        headers: { origin: ORIGIN },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      },
      (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) resolve();
        else reject(new Error("CodeFree O 未接受授权回调"));
      },
    );
    request.once("error", (error) => {
      reject(new Error("CodeFree O 授权回调未完成", { cause: error }));
    });
  });
}

export async function authorizeCodefree(
  launch: AcpAgentLauncher,
  cwd: string,
  attemptId: string,
  elicitations: AcpElicitations,
  signal: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const lifetime = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  ]);
  let offered = false;
  let callbackFailure: unknown;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
  const options: AcpAgentLaunchOptions = {
    allowDisabled: true,
    signal: lifetime,
    handshakeTimeoutMs: LOGIN_TIMEOUT_MS,
    onStderrLine(line) {
      if (offered || lifetime.aborted) return;
      const authorization = parseCodefreeAuthorization(line);
      if (!authorization) return;
      offered = true;
      void (async () => {
        const opening = elicitations.request(
          CODEFREE_ENGINE,
          attemptId,
          method.name,
          {
            requestId: attemptId,
            mode: "url",
            url: authorization.url,
            elicitationId: attemptId,
            message:
              "打开 CodeFree O 授权页，登录后将自动尝试回调。 Open the CodeFree O authorization page to sign in.",
          },
          lifetime,
        );
        // 厂商进程已尝试打开浏览器，发布已打开状态并立即准备授权码表单。
        const pendingUrl = elicitations.list(CODEFREE_ENGINE).find(({ mode }) => mode === "url");
        if (!pendingUrl) return;
        elicitations.resolve({ ...pendingUrl, resolution: { action: "accept", content: {} } });
        await opening;
        // 同机回调成功会结束握手并清理表单，远程浏览器可提交厂商页面显示的授权码。
        const answer = await elicitations.request(
          CODEFREE_ENGINE,
          attemptId,
          method.name,
          {
            requestId: attemptId,
            mode: "form",
            message:
              "自动回调未完成时，粘贴授权页显示的授权码。 If the callback does not complete, paste the authorization code.",
            requestedSchema: {
              type: "object",
              required: ["code"],
              properties: {
                code: {
                  type: "string",
                  title: "授权码 / Authorization code",
                  minLength: 1,
                  maxLength: 4096,
                },
              },
            },
          },
          lifetime,
        );
        if (lifetime.aborted) return;
        const content = answer.action === "accept" ? answer.content : undefined;
        if (
          !content ||
          typeof content !== "object" ||
          !("code" in content) ||
          typeof content.code !== "string"
        ) {
          controller.abort();
          return;
        }
        // 厂商回调会先返回 HTTP 200，再交换令牌。只有原进程的 ACP 握手确认登录完成。
        confirmationTimer = setTimeout(() => {
          callbackFailure = new Error("CodeFree O 未确认授权，请重新登录并使用新授权码");
          controller.abort();
        }, CALLBACK_CONFIRMATION_MS);
        confirmationTimer.unref();
        try {
          await forwardCodefreeAuthorization(authorization.callback, content.code, lifetime);
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined;
          // 浏览器可能已先完成回调并关闭监听器，让同一进程继续完成握手。
          if (
            !(cause instanceof Error) ||
            !("code" in cause) ||
            (cause.code !== "ECONNREFUSED" && cause.code !== "ECONNRESET")
          )
            throw error;
        }
      })().catch((error: unknown) => {
        if (lifetime.aborted) return;
        callbackFailure = error;
        controller.abort();
      });
    },
  };
  try {
    const handle = await launch(
      CODEFREE_ENGINE,
      {
        id: "acp-settings",
        kind: "temporary",
        rootPath: cwd,
        runtimeWorkspaceRoots: [cwd],
      },
      {},
      options,
    );
    await handle.close();
  } catch (error) {
    throw callbackFailure ?? error;
  } finally {
    clearTimeout(confirmationTimer);
    controller.abort();
  }
}
