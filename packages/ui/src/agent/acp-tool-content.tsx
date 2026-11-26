interface TextContent {
  type: "text";
  text: string;
  uri?: string;
}
interface ResourceLink {
  type: "resource_link";
  name: string;
  uri: string;
  description?: string;
}
type DisplayContent = TextContent | ResourceLink;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readContent(value: unknown): DisplayContent | undefined {
  const wrapper = object(value);
  if (wrapper?.["type"] !== "content") return;
  const block = object(wrapper["content"]);
  if (block?.["type"] === "text" && typeof block["text"] === "string")
    return { type: "text", text: block["text"] };
  if (
    block?.["type"] === "resource_link" &&
    typeof block["name"] === "string" &&
    typeof block["uri"] === "string"
  )
    return {
      type: "resource_link",
      name: block["name"],
      uri: block["uri"],
      ...(typeof block["description"] === "string" ? { description: block["description"] } : {}),
    };
  if (block?.["type"] !== "resource") return;
  const resource = object(block["resource"]);
  if (typeof resource?.["uri"] === "string" && typeof resource["text"] === "string")
    return { type: "text", text: resource["text"], uri: resource["uri"] };
  return;
}

function webLink(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    // file、MCP 自定义 URI 和损坏地址仍作为文字保留，不交给浏览器或桌面协议处理器。
  }
  return;
}

/** 只识别 ACP 工具内容包装；未知或混合输出整体回退，避免悄悄丢掉 diff、终端或未来字段。 */
export function renderAcpToolContent(output: unknown) {
  if (!Array.isArray(output) || !output.length || output.length > 128) return null;
  const blocks: DisplayContent[] = [];
  for (const value of output) {
    const block = readContent(value);
    if (!block) return null;
    blocks.push(block);
  }
  return (
    <div
      className="max-h-96 space-y-3 overflow-auto text-label [overflow-wrap:anywhere]"
      tabIndex={0}
    >
      {blocks.map((block, index) => {
        if (block.type === "text")
          return (
            <div key={index}>
              {block.uri ? <p className="text-muted-foreground">{block.uri}</p> : null}
              <div className="whitespace-pre-wrap">{block.text}</div>
            </div>
          );
        const href = webLink(block.uri);
        return (
          <div key={index}>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 focus-visible:outline-auto"
              >
                {block.name || block.uri}
              </a>
            ) : (
              <p>{block.name || block.uri}</p>
            )}
            {block.name ? <p className="text-muted-foreground">{block.uri}</p> : null}
            {block.description ? <p className="whitespace-pre-wrap">{block.description}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
