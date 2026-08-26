import { Buffer } from "node:buffer";

import { WorkbenchPetProviderError } from "@codexly/core";
import {
  AgentMutationErrorSchema,
  WorkbenchPetCatalogResponseSchema,
  WorkbenchPetDownloadRequestSchema,
  WorkbenchPetDownloadResponseSchema,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";

import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ErrorResponseSchema, IdempotencyHeadersSchema } from "./schemas.js";

const PetAssetParamsSchema = {
  additionalProperties: false,
  properties: { assetId: { pattern: "^[a-f0-9]{64}$", type: "string" } },
  required: ["assetId"],
  type: "object",
} as const;

export const registerPetRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  { petProvider, runIdempotent },
  done,
) => {
  app.get(
    "/v1/pets",
    {
      schema: {
        response: { 200: WorkbenchPetCatalogResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (_request, reply) => {
      try {
        return { data: await petProvider.listPets() };
      } catch {
        return reply
          .code(500)
          .send({ code: "PET_CATALOG_UNAVAILABLE", message: "Pet catalog is unavailable" });
      }
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/v1/pets/assets/:assetId",
    {
      schema: {
        params: PetAssetParamsSchema,
        response: {
          404: ErrorResponseSchema,
          422: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const asset = await petProvider.openPetAsset(request.params.assetId);
        if (asset === undefined) {
          return await reply
            .code(404)
            .send({ code: "PET_NOT_FOUND", message: "Pet asset not found" });
        }
        reply
          .header("Cache-Control", "private, no-cache")
          .header("Cross-Origin-Resource-Policy", "same-origin")
          .header("ETag", asset.etag)
          .header("X-Content-Type-Options", "nosniff");
        if (request.headers["if-none-match"] === asset.etag) return await reply.code(304).send();
        return await reply.type(asset.contentType).send(Buffer.from(asset.content));
      } catch (error) {
        if (error instanceof WorkbenchPetProviderError && error.code === "invalid") {
          return await reply
            .code(422)
            .send({ code: "PET_ASSET_INVALID", message: "Pet asset is invalid" });
        }
        return await reply
          .code(500)
          .send({ code: "PET_ASSET_UNAVAILABLE", message: "Pet asset is unavailable" });
      }
    },
  );

  app.post<{
    Body: { petId: string };
    Headers: { "idempotency-key": string };
  }>(
    "/v1/pets/downloads",
    {
      schema: {
        body: WorkbenchPetDownloadRequestSchema,
        headers: IdempotencyHeadersSchema,
        response: {
          200: WorkbenchPetDownloadResponseSchema,
          400: AgentMutationErrorSchema,
          404: AgentMutationErrorSchema,
          409: AgentMutationErrorSchema,
          502: AgentMutationErrorSchema,
          503: AgentMutationErrorSchema,
        },
      },
    },
    async (request) =>
      runIdempotent(
        ["download-workbench-pet", request.body.petId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          try {
            return { data: await petProvider.ensurePetAsset(request.body.petId) };
          } catch (error) {
            if (error instanceof WorkbenchPetProviderError) {
              if (error.code === "not_found") {
                throw new MutationHttpError("PET_NOT_FOUND", "Pet not found", 404);
              }
              if (error.code === "invalid") {
                throw new MutationHttpError("PET_ASSET_INVALID", "Pet cannot be downloaded", 400);
              }
            }
            throw new MutationHttpError(
              "PET_DOWNLOAD_FAILED",
              "Pet asset download failed",
              502,
              true,
            );
          }
        },
      ),
  );
  done();
};
