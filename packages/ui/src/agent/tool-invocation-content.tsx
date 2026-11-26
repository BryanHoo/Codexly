import type { AgentMessageAttachment } from "@codexly/protocol";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { readSourceAttachment } from "../core/message-source-attachment.js";
import { useAgentTranslation } from "./locale.js";
import { ToolInput, ToolOutput } from "./tool.js";

// 详情只自动读取较小的单段正文，长日志继续通过原有附件入口查看。
const MAX_INLINE_TOOL_ATTACHMENT_BYTES = 256 * 1024;
const overflowFileName = /^工具(输入|输出)-([1-9][0-9]*)\.txt$/u;

type Field = "input" | "output";
type ToolPayload = Readonly<{
  id: string;
  input?: unknown;
  output?: unknown;
  outputAttachments?: readonly AgentMessageAttachment[];
}>;

type AttachmentActions = Readonly<{
  attachmentUrl: (attachment: AgentMessageAttachment) => string;
  Attachment: ComponentType<{ attachment: AgentMessageAttachment; url: string }>;
}>;

type LoadingLabels = Readonly<{ loading: string; error: string }>;

export function ToolInvocationContent({
  item,
  failed,
  labels,
  attachmentUrl,
  Attachment,
}: AttachmentActions & { item: ToolPayload; failed: boolean; labels: LoadingLabels }) {
  const fields: Record<Field, AgentMessageAttachment[]> = { input: [], output: [] };
  const otherFiles: AgentMessageAttachment[] = [];
  for (const attachment of item.outputAttachments ?? []) {
    // 兼容已保存的 ACP 历史，生成附件使用受控历史 ID 和固定文件名。
    const match =
      item.id.includes("acp:tool:") &&
      attachment.id.startsWith("history-") &&
      attachment.kind === "text" &&
      attachment.mediaType === "text/plain"
        ? overflowFileName.exec(attachment.name)
        : null;
    if (match) fields[match[1] === "输入" ? "input" : "output"].push(attachment);
    else otherFiles.push(attachment);
  }
  const renderAttachment = (attachment: AgentMessageAttachment) => (
    <Attachment key={attachment.id} attachment={attachment} url={attachmentUrl(attachment)} />
  );
  const renderField = (field: Field) => {
    const attachments = fields[field];
    const value = item[field];
    const file = attachments.length === 1 ? attachments[0] : undefined;
    const hasPreview = typeof value === "string" && (value === "…" || value.endsWith("\n…"));
    if (hasPreview && file && file.size <= MAX_INLINE_TOOL_ATTACHMENT_BYTES) {
      const url = attachmentUrl(file);
      return (
        <StoredToolField
          key={url}
          url={url}
          field={field}
          failed={failed}
          preview={value === "…" ? undefined : value}
          labels={labels}
          fallback={renderAttachment(file)}
        />
      );
    }
    return (
      <>
        <ToolField
          field={field}
          failed={failed}
          value={attachments.length > 0 && value === "…" ? undefined : value}
        />
        {attachments.map(renderAttachment)}
      </>
    );
  };

  return (
    <>
      {renderField("input")}
      {renderField("output")}
      {otherFiles.map(renderAttachment)}
    </>
  );
}

function ToolField({ field, value, failed }: { field: Field; value: unknown; failed: boolean }) {
  if (value === undefined) return null;
  if (field === "input") return <ToolInput input={value} />;
  return (
    <ToolOutput
      errorText={
        failed ? (typeof value === "string" ? value : JSON.stringify(value, null, 2)) : undefined
      }
      output={failed ? undefined : value}
    />
  );
}

function StoredToolField({
  url,
  field,
  failed,
  preview,
  labels,
  fallback,
}: {
  url: string;
  field: Field;
  failed: boolean;
  preview: unknown;
  labels: LoadingLabels;
  fallback: ReactNode;
}) {
  const { t } = useAgentTranslation();
  const [result, setResult] = useState<{ value: unknown } | "error">();
  useEffect(() => {
    // 内容组件随工具展开挂载，折叠或关闭弹窗时取消父任务附件读取。
    const request = new AbortController();
    void readSourceAttachment(url, request.signal).then(
      (text) => {
        if (request.signal.aborted) return;
        let value: unknown = text;
        // 历史附件中结构化工具数据以 JSON 保存。纯文本和不完整的记录按原文展示。
        if (text.startsWith("{") || text.startsWith("[")) {
          try {
            value = JSON.parse(text) as unknown;
          } catch {
            // 继续展示此附件中的原始正文。
          }
        }
        setResult({ value });
      },
      () => {
        if (!request.signal.aborted) setResult("error");
      },
    );
    return () => {
      request.abort();
    };
  }, [url]);

  if (result && result !== "error") {
    return <ToolField field={field} failed={failed} value={result.value} />;
  }
  const label = field === "input" ? "toolInput" : failed ? "toolError" : "toolResult";
  return (
    <div>
      {preview === undefined ? (
        <span className="mb-1 block text-label">{t(`agentComponents.${label}`)}</span>
      ) : (
        <ToolField field={field} failed={failed} value={preview} />
      )}
      {result === "error" ? (
        <>
          <p role="alert" className="mb-1 text-label text-danger">
            {labels.error}
          </p>
          {fallback}
        </>
      ) : (
        <p role="status" className="text-label text-muted-foreground">
          {labels.loading}
        </p>
      )}
    </div>
  );
}
