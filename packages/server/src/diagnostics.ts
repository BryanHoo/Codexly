import type { FastifyInstance } from "fastify";
import { DiagnosticsResponseSchema } from "@codexly/protocol";
import type { CreateCodexlyServerOptions } from "./server-options.js";

const LOG_FIELDS = [
  "level",
  "time",
  "component",
  "phase",
  "event",
  "errorCode",
  "diagnosticCode",
  "errorClass",
  "systemCode",
  "errorFingerprint",
  "statusCode",
  "method",
  "route",
  "requestId",
  "projectId",
  "taskId",
  "turnId",
  "durationMs",
] as const;

export class DiagnosticLogBuffer {
  private readonly entries: (Readonly<{ line: string; bytes: number }> | undefined)[];
  private head = 0;
  private count = 0;
  private bytes = 0;
  private droppedEntries = 0;

  public constructor(
    private readonly maxBytes = 2 * 1024 * 1024,
    private readonly maxEntries = 2_000,
  ) {
    this.entries = new Array<Readonly<{ line: string; bytes: number }> | undefined>(maxEntries);
  }

  public write(message: string): void {
    // 同步日志链路只处理有界 JSON；白名单投影避免正文、Cookie 和任意附加字段驻留。
    if (message.length > 65_536) {
      this.droppedEntries++;
      return;
    }
    try {
      const parsed: unknown = JSON.parse(message);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const input = parsed as Record<string, unknown>;
      const fields: Record<string, string | number> = {};
      for (const key of LOG_FIELDS) {
        const value = input[key];
        if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
        else if (typeof value === "string") fields[key] = value.slice(0, 256);
      }
      if (typeof fields["level"] !== "number") return;
      const line = JSON.stringify(fields);
      const bytes = Buffer.byteLength(line);
      if (bytes > this.maxBytes || this.maxEntries < 1) {
        this.droppedEntries++;
        return;
      }
      while (this.count >= this.maxEntries || this.bytes + bytes > this.maxBytes) this.evict();
      this.entries[(this.head + this.count) % this.maxEntries] = { line, bytes };
      this.count++;
      this.bytes += bytes;
    } catch {
      // 日志解析失败绝不能影响原 HTTP 请求。
    }
  }

  public snapshot(): { logs: string[]; droppedEntries: number } {
    return {
      logs: Array.from(
        { length: this.count },
        (_, index) => this.entries[(this.head + index) % this.maxEntries]?.line ?? "",
      ),
      droppedEntries: this.droppedEntries,
    };
  }

  public clear(): void {
    this.entries.fill(undefined);
    this.head = this.count = this.bytes = this.droppedEntries = 0;
  }

  private evict(): void {
    this.bytes -= this.entries[this.head]?.bytes ?? 0;
    this.entries[this.head] = undefined;
    this.head = (this.head + 1) % this.maxEntries;
    this.count--;
    this.droppedEntries++;
  }
}

export function createDiagnosticLogger(
  diagnosticLogs: DiagnosticLogBuffer,
  options: Pick<CreateCodexlyServerOptions, "loggerEnabled" | "logDestination">,
) {
  return options.loggerEnabled === false
    ? false
    : {
        // 请求控制器仅放行关键操作、慢请求和错误。
        level: "info",
        // 即使后续扩展请求 Serializer，也不能让认证字段进入结构化日志。
        redact: {
          censor: "[Redacted]",
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            'req.headers["x-api-key"]',
            'res.headers["set-cookie"]',
          ],
        },
        stream: {
          write(message: string) {
            diagnosticLogs.write(message);
            // 默认仅缓存供诊断导出，避免运行日志刷屏；显式配置时仍写入托管后台日志。
            options.logDestination?.write(message);
          },
        },
      };
}

export function registerDiagnosticRoutes(
  app: FastifyInstance,
  diagnosticLogs: DiagnosticLogBuffer,
): void {
  app.get(
    "/v1/diagnostics",
    {
      schema: { response: { 200: DiagnosticsResponseSchema } },
    },
    (_request, reply) => {
      // 复用全局访问认证；导出不依赖联网版本检查，且浏览器与代理均不得缓存。
      reply.header("Cache-Control", "no-store");
      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        runtime: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptimeSeconds: process.uptime(),
          memoryBytes: process.memoryUsage.rss(),
        },
        ...diagnosticLogs.snapshot(),
      };
    },
  );
  app.addHook("onClose", (_instance, done) => {
    diagnosticLogs.clear();
    done();
  });
}
