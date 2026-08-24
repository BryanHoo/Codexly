import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import { normalizeAllowedHost } from "./server-delivery.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

describe("server access security", () => {
  it("keeps local access open and protects LAN business routes", async () => {
    const local = await createCodeAgentServer(createServerOptions(createProvider().provider));
    closeCallbacks.push(() => local.close());
    const lan = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => lan.close());

    const localStatus = await local.inject({ method: "GET", url: "/v1/access" });
    const lanStatus = await lan.inject({ method: "GET", url: "/v1/access" });
    const health = await lan.inject({ method: "GET", url: "/v1/health" });
    const protectedResponse = await lan.inject({ method: "GET", url: "/v1/projects" });

    expect(localStatus.json()).toEqual({ authenticated: true, mode: "local", version: 1 });
    expect(lanStatus.json()).toEqual({ authenticated: false, mode: "lan", version: 1 });
    expect(health.statusCode).toBe(200);
    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.json()).toEqual({
      code: "ACCESS_DENIED",
      message: "Access denied",
      retryable: false,
    });
    expect(protectedResponse.headers["cache-control"]).toBe("no-store");
    expect(protectedResponse.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(protectedResponse.headers["content-security-policy"]).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(protectedResponse.headers["content-security-policy"]).toContain(
      "img-src 'self' blob: data:",
    );
    expect(protectedResponse.headers["x-frame-options"]).toBe("DENY");
    expect(protectedResponse.headers["strict-transport-security"]).toBeUndefined();
  });

  it("rejects DNS rebinding hosts and cross-origin local browser mutations", async () => {
    const local = await createCodeAgentServer(createServerOptions(createProvider().provider));
    closeCallbacks.push(() => local.close());
    const lan = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => lan.close());

    const reboundRead = await local.inject({
      headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      method: "GET",
      url: "/v1/projects",
    });
    const crossOriginWrite = await local.inject({
      headers: { host: "127.0.0.1:3210", origin: "http://attacker.example:3210" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/unsubscribe",
    });
    const reboundPair = await lan.inject({
      headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });

    expect(reboundRead.statusCode).toBe(403);
    expect(crossOriginWrite.statusCode).toBe(403);
    expect(reboundPair.statusCode).toBe(403);
    await expect(
      local.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "attacker.example:3210", origin: "http://attacker.example:3210" },
      }),
    ).rejects.toThrow(/Unexpected server response: 403/u);
  });

  it("allows only explicitly configured reverse proxy domains", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        allowedHosts: [normalizeAllowedHost("Code.Example.com")],
      }),
    );
    closeCallbacks.push(() => app.close());

    const allowedRead = await app.inject({
      headers: { host: "code.example.com" },
      method: "GET",
      url: "/v1/projects",
    });
    const allowedWrite = await app.inject({
      headers: { host: "code.example.com", origin: "https://code.example.com" },
      method: "POST",
      url: "/v1/access/logout",
    });
    const unknownHost = await app.inject({
      headers: { host: "other.example.com" },
      method: "GET",
      url: "/v1/projects",
    });
    const subdomain = await app.inject({
      headers: { host: "child.code.example.com" },
      method: "GET",
      url: "/v1/projects",
    });

    expect(allowedRead.statusCode).toBe(200);
    expect(allowedWrite.statusCode).toBe(200);
    expect(unknownHost.statusCode).toBe(403);
    expect(subdomain.statusCode).toBe(403);
  });

  it("rejects non-domain allowed Host values", () => {
    for (const invalid of [
      "*.example.com",
      "https://code.example.com",
      "code.example.com:443",
      "127.0.0.1",
      "bad..example.com",
    ]) {
      expect(() => normalizeAllowedHost(invalid)).toThrow(/allowed Host/u);
    }
  });

  it("does not expose unknown server error details", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        readProjectDirectory: vi.fn(() =>
          Promise.reject(new Error("sensitive path /Users/example/private.txt")),
        ),
      }),
    );
    closeCallbacks.push(() => app.close());

    const response = await app.inject({ method: "GET", url: "/v1/project-directories" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      retryable: false,
    });
    expect(response.body).not.toContain("/Users/example/private.txt");
  });

  it("pairs browsers, enforces origin, and logs out the exact session", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => app.close());

    const invalid = await app.inject({
      method: "POST",
      payload: { code: "" },
      url: "/v1/access/pair",
    });
    const failed = await app.inject({
      method: "POST",
      payload: { code: "wrong" },
      url: "/v1/access/pair",
    });
    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
    expect(failed.statusCode).toBe(403);
    expect(failed.json()).toMatchObject({ code: "PAIRING_FAILED", retryable: false });
    expect(paired.json()).toEqual({ authenticated: true, mode: "lan", version: 1 });
    expect(cookie).toMatchObject({ httpOnly: true, name: "codeagent_session", sameSite: "Strict" });
    expect(cookie?.secure).toBeUndefined();
    expect(cookie?.["path"]).toBe("/");
    expect(cookie?.maxAge).toBe(86_400);

    const authenticated = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "GET",
      url: "/v1/projects",
    });
    const missingOrigin = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const wrongOrigin = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      headers: { host: "192.168.1.20", origin: "http://attacker.local" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const loggedOut = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      headers: { host: "192.168.1.20", origin: "http://192.168.1.20" },
      method: "POST",
      payload: {},
      url: "/v1/access/logout",
    });
    const afterLogout = await app.inject({
      cookies: { codeagent_session: cookie?.value ?? "" },
      method: "GET",
      url: "/v1/projects",
    });

    expect(authenticated.statusCode).toBe(200);
    expect(missingOrigin.statusCode).toBe(403);
    expect(wrongOrigin.statusCode).toBe(403);
    expect(loggedOut.json()).toEqual({ authenticated: false, mode: "lan", version: 1 });
    expect(loggedOut.cookies[0]).toMatchObject({ name: "codeagent_session", value: "" });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("uses a session Cookie without an expiry when no TTL is configured", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code" },
      }),
    );
    closeCallbacks.push(() => app.close());

    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];

    expect(paired.statusCode).toBe(200);
    expect(cookie?.expires).toBeUndefined();
    expect(cookie?.maxAge).toBeUndefined();
  });

  it("rejects unauthenticated and cross-origin LAN WebSockets", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 86_400_000 },
      }),
    );
    closeCallbacks.push(() => app.close());

    await expect(
      app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
        headers: { host: "192.168.1.20", origin: "http://192.168.1.20" },
      }),
    ).rejects.toThrow(/Unexpected server response: 401/u);
  });

  it("closes an authenticated LAN WebSocket at the absolute session expiry", async () => {
    const app = await createCodeAgentServer(
      createServerOptions(createProvider().provider, {
        access: { pairingCode: "test-pairing-code", sessionTtlMs: 50 },
      }),
    );
    closeCallbacks.push(() => app.close());
    const paired = await app.inject({
      method: "POST",
      payload: { code: "test-pairing-code" },
      url: "/v1/access/pair",
    });
    const cookie = paired.cookies[0];
    const socket = await app.injectWS("/v1/projects/code-agent/events?afterSequence=0", {
      headers: {
        cookie: `${cookie?.name ?? ""}=${cookie?.value ?? ""}`,
        host: "192.168.1.20",
        origin: "http://192.168.1.20",
      },
    });

    await vi.waitFor(() => {
      expect(socket.readyState).toBe(socket.CLOSED);
    });
  });
});
