import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { configureServerDelivery } from "./server-delivery.js";

describe("Web upgrade delivery", () => {
  it.each(["identity", "br", "gzip"])(
    "delivers the new entry despite legacy npm package validators (%s)",
    async (encoding) => {
      const root = await mkdtemp(join(tmpdir(), "codexly-upgrade-cache-"));
      const legacy = Fastify();
      const updated = Fastify();
      const oldHtml = '<script src="/assets/index-AAAAAAAA.js"></script>';
      const newHtml = '<script src="/assets/index-BBBBBBBB.js"></script>';
      // npm tarball 固定文件时间；内容哈希等长变化不会改变旧版弱 ETag。
      const packedTime = new Date("1985-10-26T08:15:00.000Z");
      const writeEntry = async (html: string) => {
        const files = [
          ["index.html", Buffer.from(html)],
          ["index.html.br", brotliCompressSync(html)],
          ["index.html.gz", gzipSync(html)],
        ] as const;
        for (const [name, body] of files) {
          const path = join(root, name);
          await writeFile(path, body);
          await utimes(path, packedTime, packedTime);
        }
      };
      try {
        await writeEntry(oldHtml);
        await legacy.register(fastifyStatic, { root, preCompressed: true });
        const previous = await legacy.inject({
          url: "/",
          headers: { "accept-encoding": encoding },
        });
        const etag = previous.headers.etag;
        const lastModified = previous.headers["last-modified"];
        if (typeof etag !== "string" || typeof lastModified !== "string") {
          throw new Error("旧版交付样本必须包含 ETag 和 Last-Modified");
        }
        await legacy.close();
        await writeEntry(newHtml);
        await configureServerDelivery(updated, {
          staticRoot: root,
          releaseResources: () => Promise.resolve(),
        });
        for (const url of ["/", "/index.html", "/p/codexly/t/task-1"]) {
          for (const validators of [
            { "if-none-match": etag },
            { "if-modified-since": lastModified },
          ]) {
            const response = await updated.inject({
              url,
              headers: { "accept-encoding": encoding, ...validators },
            });
            expect(response.statusCode, url).toBe(200);
            const body =
              encoding === "br"
                ? brotliDecompressSync(response.rawPayload)
                : encoding === "gzip"
                  ? gunzipSync(response.rawPayload)
                  : response.rawPayload;
            expect(body.toString("utf8")).toBe(newHtml);
            expect(response.headers["cache-control"]).toBe("no-store");
          }
        }
      } finally {
        await Promise.all([legacy.close(), updated.close()]);
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("returns uncached 404s for removed assets while preserving SPA navigation", async () => {
    const root = await mkdtemp(join(tmpdir(), "codexly-upgrade-assets-"));
    const app = Fastify();
    try {
      await writeFile(join(root, "index.html"), "<main>new version</main>");
      await configureServerDelivery(app, {
        staticRoot: root,
        releaseResources: () => Promise.resolve(),
      });
      for (const url of [
        "/assets/index-OLD.js",
        "/assets/index-OLD.css?version=old",
        "/missing.js",
        "/favicon.ico",
      ]) {
        const response = await app.inject({ url });
        expect(response.statusCode, url).toBe(404);
        expect(response.headers["content-type"]).toContain("application/json");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
      for (const url of ["/p/project/t/task", "/p/project.with.dots"]) {
        const response = await app.inject({ url, headers: { accept: "text/html" } });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe("<main>new version</main>");
      }
    } finally {
      await app.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
