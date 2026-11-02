/** 原始数据来自 JSON 协议；逐标量遍历，长字符串也按固定窗口转义，避免单条消息撑大临时缓冲。 */
export function* jsonChunks(value: unknown, depth = 0): Generator<string> {
  if (typeof value === "string") {
    yield '"';
    for (let start = 0; start < value.length;) {
      let end = Math.min(start + 8192, value.length);
      // 不拆开 UTF-16 代理对，否则分段 stringify 会把合法 Emoji 转成两个孤立代理项。
      const last = value.charCodeAt(end - 1);
      if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
      yield JSON.stringify(value.slice(start, end)).slice(1, -1);
      start = end;
    }
    yield '"';
  } else if (value === null || typeof value !== "object") {
    yield value === undefined || typeof value === "function" || typeof value === "symbol"
      ? "null"
      : JSON.stringify(value);
  } else {
    const array = Array.isArray(value);
    const entries = array ? value.keys() : Object.keys(value);
    yield array ? "[" : "{";
    let count = 0;
    for (const key of entries) {
      const child: unknown = (value as Record<string | number, unknown>)[key];
      if (
        !array &&
        (child === undefined || typeof child === "function" || typeof child === "symbol")
      )
        continue;
      yield `${count++ === 0 ? "" : ","}\n${"  ".repeat(depth + 1)}`;
      if (!array) {
        yield* jsonChunks(String(key));
        yield ": ";
      }
      yield* jsonChunks(child, depth + 1);
    }
    if (count > 0) yield `\n${"  ".repeat(depth)}`;
    yield array ? "]" : "}";
  }
}

export class JsonByteBudget {
  private bytes = 0;
  private readonly encoder = new TextEncoder();
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }

  add(chunk: string): Uint8Array<ArrayBuffer> {
    // 每次编码仅处理有界片段；预算包含转义、缩进和换行，文件限制不再依赖整份二次编码。
    const encoded = this.encoder.encode(chunk);
    this.bytes += encoded.byteLength;
    if (this.bytes > this.limit) throw new RangeError("Conversation export exceeds 64 MiB");
    return encoded;
  }
}

export function jsonBlob(value: unknown, limit: number): Blob {
  const budget = new JsonByteBudget(limit);
  const parts: Blob[] = [];
  let pending = "";
  for (const chunk of jsonChunks(value)) {
    // 合并小 Token，控制 Blob 分片数量；单个临时字符串保持在约 64 KiB 内。
    if (pending.length + chunk.length > 16_384) {
      parts.push(new Blob([budget.add(pending)]));
      pending = "";
    }
    pending += chunk;
  }
  parts.push(new Blob([budget.add(pending + "\n")]));
  // 已封装的 Blob 分片可直接组合，避免最终构造时再复制整份编码缓冲。
  return new Blob(parts, { type: "application/json;charset=utf-8" });
}
