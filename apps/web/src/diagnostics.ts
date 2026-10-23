import type { CodexlyClient } from "@codexly/client";
import type { AppInfoResponse } from "@codexly/protocol";
import type { FrontendErrorDiagnostic } from "@codexly/frontend-core/application-diagnostics";

type BrowserDiagnostic = Readonly<{
  time: string;
  event: string;
  level: "error";
  errorMessage: string;
  stack: string | null;
}>;

function sanitizeText(value: string, limit: number): string {
  const bounded = value.slice(0, 8_192);
  if (
    /authorization|bearer\s|api[_-]?key|access[_-]?token|password|secret|cookie|sk-[\w-]+/iu.test(
      bounded,
    )
  )
    return "[redacted sensitive text]";
  // 仅保留脚本文件名与行列定位，删除来源地址、查询参数和宿主路径。
  return bounded
    .replace(/(?:https?:\/\/|file:\/\/\/|[A-Z]:\\|\/)[^\s)]+/giu, (path) => {
      const clean = path.split(/[?#]/u)[0] ?? "";
      return /(?:^|[/\\])([\w.-]+\.[cm]?[jt]sx?(?::\d+){0,2})$/u.exec(clean)?.[1] ?? "[path]";
    })
    .slice(0, limit);
}

export class BrowserDiagnosticBuffer {
  private readonly entries: BrowserDiagnostic[] = [];
  private droppedEntries = 0;

  public record(input: FrontendErrorDiagnostic): void {
    // 不保留应用 context、输入内容或页面 URL；每条与总条数均受限，刷新后清空。
    if (this.entries.length === 100) {
      this.entries.shift();
      this.droppedEntries++;
    }
    this.entries.push({
      time: new Date().toISOString(),
      event: /^[a-z_.-]{1,64}$/u.test(input.event) ? input.event : "invalid_frontend_event",
      level: "error",
      errorMessage: sanitizeText(input.errorMessage ?? "Unknown application error", 512),
      stack: input.stack === null ? null : sanitizeText(input.stack, 2_048),
    });
  }

  public snapshot() {
    return {
      logs: this.entries.map((entry) => ({ ...entry })),
      droppedEntries: this.droppedEntries,
    };
  }
}

const browserDiagnostics = new BrowserDiagnosticBuffer();
export const recordFrontendDiagnostic = (input: FrontendErrorDiagnostic): void => {
  browserDiagnostics.record(input);
};

type DiagnosticVersions = Pick<AppInfoResponse, "appVersion" | "codexVersion" | "claudeVersion">;

export async function exportDiagnostics(
  client: Pick<CodexlyClient, "getDiagnostics">,
  appInfo?: DiagnosticVersions,
): Promise<string> {
  const server = await client.getDiagnostics();
  const exportedAt = new Date().toISOString();
  const fileName = `codexly-diagnostics-web-${exportedAt.replaceAll(/[:.]/gu, "-")}.json`;
  const file = new Blob(
    [
      JSON.stringify(
        {
          version: 1,
          exportedAt,
          manifest: {
            appVersion: appInfo?.appVersion ?? null,
            codexVersion: appInfo?.codexVersion ?? null,
            claudeVersion: appInfo?.claudeVersion ?? null,
            platform: "web",
          },
          browser: {
            userAgent: navigator.userAgent.slice(0, 512),
            language: navigator.language,
            ...browserDiagnostics.snapshot(),
          },
          server,
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // 给移动浏览器足够时间接管下载，再释放 Blob，避免长期占用内存。
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
  }
  return fileName;
}
