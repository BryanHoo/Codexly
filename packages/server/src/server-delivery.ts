import { relative, sep } from "node:path";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { MAX_AGENT_FILE_BYTES, TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";

import { AccessSessionService, type CodexlyAccessOptions } from "./access-control.js";
import { ACCESS_SESSION_COOKIE } from "./routes/access-routes.js";
import { MutationHttpError } from "./routes/context.js";

function isInternalTemporaryProjectPath(pathname: string): boolean {
  const prefix = "/v1/projects/";
  if (!pathname.startsWith(prefix)) {
    return false;
  }
  const encodedProjectId = pathname.slice(prefix.length).split("/", 1)[0];
  try {
    return decodeURIComponent(encodedProjectId ?? "") === TEMPORARY_TASK_SCOPE_ID;
  } catch {
    return false;
  }
}

function parseRequestHost(host: string | undefined): URL | undefined {
  if (host === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(`http://${host}`);
    return parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function normalizeAllowedHost(value: string): string {
  const normalized = domainToASCII(value).toLowerCase();
  const labels = normalized.split(".");
  if (
    value === "" ||
    value !== value.trim() ||
    normalized.length > 253 ||
    isIP(normalized) !== 0 ||
    labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))
  ) {
    throw new Error(
      "Invalid allowed Host; expected a domain name without scheme, port, or wildcard",
    );
  }
  return normalized;
}

function isAllowedRequestHost(
  host: URL,
  lanAccess: boolean,
  allowedHosts: ReadonlySet<string>,
): boolean {
  const hostname = host.hostname.toLowerCase();
  const unwrappedHostname =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (
    hostname === "localhost" ||
    unwrappedHostname === "127.0.0.1" ||
    unwrappedHostname === "::1"
  ) {
    return true;
  }
  if (allowedHosts.has(unwrappedHostname)) {
    return true;
  }
  // LAN 入口只发布数字 IP URL，拒绝可被外部 DNS 重新绑定的任意主机名。
  return lanAccess && isIP(unwrappedHostname) !== 0;
}

export interface ConfigureServerDeliveryOptions {
  access?: CodexlyAccessOptions;
  allowedHosts?: readonly string[];
  releaseResources: () => Promise<void>;
  staticRoot?: string;
}

export async function configureServerDelivery(
  app: FastifyInstance,
  options: ConfigureServerDeliveryOptions,
): Promise<AccessSessionService | undefined> {
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(fastifyCookie);
  // 只构造精确域名集合，不读取代理头或提供通配回退。
  const allowedHosts = new Set((options.allowedHosts ?? []).map(normalizeAllowedHost));
  const accessService =
    options.access === undefined ? undefined : new AccessSessionService(options.access);
  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.originalUrl.split("?", 1)[0] ?? request.originalUrl;
    if (isInternalTemporaryProjectPath(pathname)) {
      return reply.code(404).send({ code: "NOT_FOUND", message: "Route not found" });
    }
    const websocket = request.headers.upgrade?.toLowerCase() === "websocket";
    const sessionId = request.cookies[ACCESS_SESSION_COOKIE];
    const requestHost = parseRequestHost(request.headers.host);
    if (
      requestHost === undefined ||
      !isAllowedRequestHost(requestHost, options.access !== undefined, allowedHosts)
    ) {
      return reply
        .code(403)
        .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
    }
    const authenticated =
      options.access === undefined || accessService?.validate(sessionId) === true;
    const anonymous =
      !pathname.startsWith("/v1/") ||
      (request.method === "GET" && (pathname === "/v1/health" || pathname === "/v1/access")) ||
      (request.method === "POST" && pathname === "/v1/access/pair");

    if (!anonymous && !authenticated) {
      return reply
        .code(401)
        .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
    }

    // Cookie 写请求必须携带 Origin；本地浏览器写请求只要携带 Origin 也必须验证，
    // 同时保留无 Origin 的受控 CLI/API 客户端调用能力。
    const browserWrite =
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      (sessionId !== undefined || request.headers.origin !== undefined);
    if (websocket || browserWrite) {
      const origin = request.headers.origin;
      try {
        const parsedOrigin = origin === undefined ? undefined : new URL(origin);
        if (
          parsedOrigin === undefined ||
          (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") ||
          parsedOrigin.host !== requestHost.host
        ) {
          throw new Error("Origin mismatch");
        }
      } catch {
        return reply
          .code(403)
          .send({ code: "ACCESS_DENIED", message: "Access denied", retryable: false });
      }
    }
  });
  // oxlint-disable-next-line typescript/require-await -- Fastify 通过 async Hook 的返回值完成 payload 交付。
  app.addHook("onSend", async (request, reply, payload) => {
    reply.headers({
      "Content-Security-Policy":
        "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });
  await app.register(fastifyMultipart, {
    limits: { fields: 0, files: 1, fileSize: MAX_AGENT_FILE_BYTES, parts: 1 },
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MutationHttpError) {
      return reply.code(error.statusCode).send({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }
    if (typeof error === "object" && error !== null && "validation" in error) {
      const key = request.headers["idempotency-key"];
      const accessMutation =
        request.routeOptions.url === "/v1/access/pair" ||
        request.routeOptions.url === "/v1/access/logout";
      const missingKey =
        !accessMutation &&
        (request.method === "POST" || request.method === "PUT") &&
        (key === undefined || key === "");
      return reply.code(400).send({
        code: missingKey ? "IDEMPOTENCY_KEY_REQUIRED" : "INVALID_REQUEST",
        message: missingKey ? "Idempotency-Key header is required" : "Request is invalid",
        retryable: false,
      });
    }
    const explicitStatusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode <= 599
        ? error.statusCode
        : 500;
    if (explicitStatusCode < 500) {
      return reply.code(explicitStatusCode).send({
        code: "INVALID_REQUEST",
        message: explicitStatusCode === 413 ? "Request is too large" : "Request is invalid",
        retryable: false,
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(explicitStatusCode).send({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      retryable: false,
    });
  });
  app.addHook("onClose", async () => {
    // Access 状态与运行时资源统一随 Fastify 实例失效。
    accessService?.close();
    await options.releaseResources();
  });

  const { staticRoot } = options;
  if (staticRoot !== undefined) {
    await app.register(fastifyStatic, {
      cacheControl: false,
      // 直接交付构建期旁路文件，避免请求阶段占用 Node.js CPU 压缩静态内容。
      preCompressed: true,
      root: staticRoot,
      setHeaders: (reply, filePath) => {
        const [topLevelDirectory] = relative(staticRoot, filePath).split(sep);
        // Vite 的 assets 目录使用内容哈希命名，可安全长期缓存；HTML 等入口继续重新验证。
        reply.header(
          "Cache-Control",
          topLevelDirectory === "assets"
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0",
        );
      },
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/")) {
        // Browser 深链统一回到 SPA 入口，API 未命中仍保持 JSON 404。
        return reply.type("text/html; charset=utf-8").sendFile("index.html");
      }
      return reply.code(404).send({ code: "NOT_FOUND", message: "Route not found" });
    });
  }
  return accessService;
}
