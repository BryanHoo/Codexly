import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { Type } from "@sinclair/typebox";
import {
  SaveDiagnosticsRequestSchema,
  SaveDiagnosticsResponseSchema,
  type SaveDiagnosticsRequest,
} from "@codexly/protocol";
import type { FastifyInstance } from "fastify";
import { ACCESS_SESSION_COOKIE } from "./routes/access-routes.js";

const DOWNLOAD_TTL_MS = 5 * 60_000;
interface ExportFile {
  directory: string;
  path: string;
  fileName: string;
  owner: string | undefined;
  timer: NodeJS.Timeout;
}

export function registerDiagnosticArchiveRoutes(app: FastifyInstance): void {
  const files = new Map<string, ExportFile>();
  const cleanups = new Set<Promise<unknown>>();
  const generations = new Set<Promise<unknown>>();
  let retained = 0;
  const cleanup = (directory: string) => {
    const pending = rm(directory, { recursive: true, force: true });
    cleanups.add(pending);
    void pending
      .catch(() => {
        app.log.warn({ event: "diagnostics_cleanup_failed" });
      })
      .finally(() => {
        retained--;
        cleanups.delete(pending);
      });
    return pending;
  };
  app.post<{ Body: SaveDiagnosticsRequest }>(
    "/v1/diagnostics/archive",
    {
      bodyLimit: 10 * 1024 * 1024,
      handlerTimeout: 30_000,
      schema: {
        body: SaveDiagnosticsRequestSchema,
        response: { 200: SaveDiagnosticsResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      // 准入计数包含生成中、待下载及传输中的归档，避免重复点击耗尽磁盘或内存。
      if (retained >= 2)
        return reply.code(429).send({ message: "Diagnostic export capacity reached" });
      retained++;
      let directory: string;
      try {
        directory = await mkdtemp(join(tmpdir(), "codexly-diagnostics-"));
      } catch {
        retained--;
        return reply.code(500).send({ message: "Diagnostic export failed" });
      }
      const generation = (async () => {
        const path = join(directory, "diagnostics.zip");
        const archive = new ZipFile();
        const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
        const writing = pipeline(archive.outputStream, output);
        archive.on("error", (error: unknown) => {
          output.destroy(error instanceof Error ? error : new Error("Diagnostic archive failed"));
        });
        // 应用快照有界，写入临时 ZIP 时沿用流式输出和现有下载租约。
        archive.addBuffer(Buffer.from(request.body.application), "application.json", {
          compress: false,
        });
        archive.addBuffer(
          Buffer.from(JSON.stringify({ version: 1, runtime: "acp" })),
          "manifest.json",
          { compress: false },
        );
        archive.end();
        await writing;
        return path;
      })();
      generations.add(generation);
      try {
        const path = await generation;
        // IncomingMessage 在正常读完 POST 正文后也会关闭，只检查响应连接是否断开。
        if (reply.raw.destroyed) {
          await cleanup(directory);
          return await reply.code(499).send();
        }
        const downloadId = randomUUID();
        const fileName = `codexly-diagnostics-web-${String(Date.now())}.zip`;
        const timer = setTimeout(() => {
          files.delete(downloadId);
          void cleanup(directory).catch(() => undefined);
        }, DOWNLOAD_TTL_MS);
        timer.unref();
        files.set(downloadId, {
          directory,
          path,
          fileName,
          owner: request.cookies[ACCESS_SESSION_COOKIE],
          timer,
        });
        return { downloadId, fileName };
      } catch {
        await cleanup(directory).catch(() => undefined);
        return await reply.code(500).send({ message: "Diagnostic export failed" });
      } finally {
        generations.delete(generation);
      }
    },
  );

  app.get<{ Params: { downloadId: string } }>(
    "/v1/diagnostics/downloads/:downloadId",
    {
      schema: { params: Type.Object({ downloadId: Type.String({ format: "uuid" }) }) },
    },
    (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const file = files.get(request.params.downloadId);
      if (!file || file.owner !== request.cookies[ACCESS_SESSION_COOKIE])
        return reply.code(404).send();
      // 认证沿用全局配对，且令牌绑定创建会话、仅可领取一次；路径从不来自 URL。
      files.delete(request.params.downloadId);
      clearTimeout(file.timer);
      const stream = createReadStream(file.path);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        stream.destroy();
        void cleanup(file.directory).catch(() => undefined);
      };
      stream.once("close", release);
      reply.raw.once("close", release);
      reply.header("Content-Disposition", `attachment; filename="${file.fileName}"`);
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.type("application/zip").send(stream);
    },
  );
  app.addHook("onClose", async () => {
    await Promise.allSettled(generations);
    for (const file of files.values()) {
      clearTimeout(file.timer);
      void cleanup(file.directory).catch(() => undefined);
    }
    files.clear();
    await Promise.allSettled(cleanups);
  });
}
