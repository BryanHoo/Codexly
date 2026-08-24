import {
  AccessStatusResponseSchema,
  PairAccessRequestSchema,
  type AccessStatusResponse,
  type PairAccessRequest,
} from "@code-agent/protocol";
import type { FastifyPluginCallback } from "fastify";

import type { AccessSessionService, CodeAgentAccessOptions } from "../access-control.js";

export const ACCESS_SESSION_COOKIE = "codeagent_session";

type AccessRouteOptions = Readonly<{
  access?: CodeAgentAccessOptions;
  service?: AccessSessionService;
}>;

function status(authenticated: boolean, mode: "local" | "lan"): AccessStatusResponse {
  return { authenticated, mode, version: 1 };
}

export const registerAccessRoutes: FastifyPluginCallback<AccessRouteOptions> = (
  app,
  options,
  done,
) => {
  const { access, service } = options;
  const mode = access === undefined ? "local" : "lan";

  app.get("/v1/access", { schema: { response: { 200: AccessStatusResponseSchema } } }, (request) =>
    status(
      mode === "local" || service?.validate(request.cookies[ACCESS_SESSION_COOKIE]) === true,
      mode,
    ),
  );

  app.post<{ Body: PairAccessRequest }>(
    "/v1/access/pair",
    {
      schema: {
        body: PairAccessRequestSchema,
        response: { 200: AccessStatusResponseSchema },
      },
    },
    (request, reply) => {
      if (access === undefined || service === undefined) {
        return status(true, "local");
      }
      const result = service.pair(request.body.code, request.ip);
      if (result.status !== "paired") {
        return reply.code(result.status === "rate_limited" ? 429 : 403).send({
          code: result.status === "rate_limited" ? "PAIRING_RATE_LIMITED" : "PAIRING_FAILED",
          message: "Pairing request failed",
          retryable: result.status === "rate_limited",
        });
      }
      reply.setCookie(ACCESS_SESSION_COOKIE, result.sessionId, {
        ...(result.expiresAt === null || access.sessionTtlMs === undefined
          ? {}
          : {
              expires: new Date(result.expiresAt),
              maxAge: Math.ceil(access.sessionTtlMs / 1_000),
            }),
        httpOnly: true,
        path: "/",
        sameSite: "strict",
        secure: false,
      });
      return status(true, "lan");
    },
  );

  app.post(
    "/v1/access/logout",
    { schema: { response: { 200: AccessStatusResponseSchema } } },
    (request, reply) => {
      service?.logout(request.cookies[ACCESS_SESSION_COOKIE]);
      reply.clearCookie(ACCESS_SESSION_COOKIE, { path: "/", sameSite: "strict" });
      return status(mode === "local", mode);
    },
  );
  done();
};
