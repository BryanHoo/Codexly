import type { FastifyInstance } from "fastify";
import { ProjectSourceFileQuerySchema, type ProjectSourceFileQuery } from "@codexly/protocol";

import type { ServerRouteContext } from "./context.js";
import { resolveReadRoot } from "./project-file-root.js";
import { ErrorResponseSchema, ProjectParamsSchema } from "./schemas.js";
import { sendProjectPdf } from "../project-pdf-response.js";

export function registerProjectPdfRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  app.get<{ Params: { projectId: string }; Querystring: ProjectSourceFileQuery }>(
    "/v1/projects/:projectId/files/pdf",
    {
      schema: {
        params: ProjectParamsSchema,
        querystring: ProjectSourceFileQuerySchema,
        response: { 400: ErrorResponseSchema, 404: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      const root = await resolveReadRoot(
        context.projectRepository,
        context.getProjectContext,
        request.params.projectId,
        request.query.rootPath,
        reply,
      );
      if (root === undefined) return;
      try {
        await sendProjectPdf(reply, root.path, request.query.path, request.headers.range);
      } catch {
        return reply
          .code(404)
          .send({ code: "PROJECT_PDF_NOT_FOUND", message: "Project PDF is unavailable" });
      }
    },
  );
}
