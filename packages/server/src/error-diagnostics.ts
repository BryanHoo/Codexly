import { createHash } from "node:crypto";

const SYSTEM_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EMFILE",
  "SQLITE_BUSY",
  "SQLITE_LOCKED",
  "SQLITE_CORRUPT",
  "SQLITE_NOTADB",
  "FST_ERR_HANDLER_TIMEOUT",
]);

function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  // 不执行 cause/code/name 上的任意 getter，也不序列化异常自带的 data/toJSON。
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function classify(error: unknown): Readonly<{ errorClass: string; systemCode?: string }> {
  const errorClass =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof SyntaxError
          ? "SyntaxError"
          : error instanceof ReferenceError
            ? "ReferenceError"
            : error instanceof AggregateError
              ? "AggregateError"
              : error instanceof Error
                ? "Error"
                : "NonError";
  const code = ownValue(error, "code");
  return {
    errorClass,
    ...(typeof code === "string" && SYSTEM_CODES.has(code) ? { systemCode: code } : {}),
  };
}

function codeLocations(error: unknown): readonly string[] {
  if (!(error instanceof Error)) return [];
  const stack: unknown = error.stack;
  if (typeof stack !== "string") return [];
  const headers = [ownValue(error, "message"), ownValue(error, "name")];
  // 多行正文和名称可能包含伪造的 at 行；完整跳过头部，过长时直接放弃位置指纹。
  if (headers.some((value) => typeof value === "string" && value.length > 16_384)) return [];
  const headerLines =
    1 +
    headers.reduce<number>(
      (count, value) => count + (typeof value === "string" ? value.split("\n").length - 1 : 0),
      0,
    );
  return stack
    .slice(0, 16_384)
    .split("\n")
    .slice(headerLines)
    .filter((line) => /^\s+at /u.test(line))
    .map(
      (line) =>
        /\/(?:packages|src|dist|apps|desktop)\/[\w./-]+\.[cm]?[jt]sx?:\d+:\d+\)?$/u.exec(
          line.replaceAll("\\", "/"),
        )?.[0],
    )
    .filter((location) => location !== undefined)
    .slice(0, 5);
}

export function errorDiagnostics(
  error: unknown,
  phase: "handler" | "validation" | "response" = "handler",
) {
  try {
    const summary = classify(error);
    const causes: ReturnType<typeof classify>[] = [];
    const seen = new Set<unknown>([error]);
    let cause = ownValue(error, "cause");
    // 最多保留三层白名单分类；循环、正文、凭据和任意附加字段均不进入日志。
    while (cause !== undefined && causes.length < 3 && !seen.has(cause)) {
      seen.add(cause);
      causes.push(classify(cause));
      cause = ownValue(cause, "cause");
    }
    // 只将代码位置参与指纹，不散列 message，路径也不输出。
    const locations = codeLocations(error);
    return {
      ...summary,
      component: "http",
      phase,
      causes,
      errorFingerprint: createHash("sha256")
        .update(JSON.stringify([summary, locations, causes]))
        .digest("hex")
        .slice(0, 24),
    };
  } catch {
    // 非标准异常或代理对象不能破坏原有错误响应。
    return {
      errorClass: "Unknown",
      component: "http",
      phase,
      causes: [],
      errorFingerprint: createHash("sha256").update("Unknown").digest("hex").slice(0, 24),
    };
  }
}
