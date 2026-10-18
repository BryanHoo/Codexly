export type SerializedSqliteWorkerError = Readonly<{
  code?: string;
  message: string;
  name: string;
}>;

export function deserializeWorkerError(error: SerializedSqliteWorkerError): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.code !== undefined) {
    Object.assign(result, { code: error.code });
  }
  return result;
}

export function isSqliteCorruption(error: Error): boolean {
  // 扩展错误码也属于同一种损坏；保留原库交由显式修复，绝不自动删库重建。
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" && /^(?:SQLITE_CORRUPT|SQLITE_NOTADB)(?:_|$)/u.test(code);
}
