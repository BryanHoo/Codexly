import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ElicitationRequestCard } from "./elicitation-request.js";
import { Button } from "./button.js";
import { parseElicitationUrl } from "@codexly/protocol";
import type {
  AcpAuthElicitationRequest,
  AcpAuthElicitationResponse,
  AgentEngine,
} from "@codexly/protocol";

export type AcpAuthElicitationClient = (
  engine: AgentEngine,
  input: AcpAuthElicitationRequest,
  options?: { signal?: AbortSignal },
) => Promise<AcpAuthElicitationResponse>;

function openBrowser(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** 只在认证等待期间查询临时问卷，复用聊天的表单及外链确认界面。 */
export function AcpAuthElicitation({
  attemptId,
  engine,
  request,
  language,
  openExternalUrl = openBrowser,
}: Readonly<{
  attemptId: string;
  engine: AgentEngine;
  request: AcpAuthElicitationClient;
  language: "zh-CN" | "en";
  openExternalUrl?: ((url: string) => void | Promise<void>) | undefined;
}>) {
  const cache = useQueryClient();
  const [failed, setFailed] = useState(false);
  const queryKey = ["acp-auth-elicitation", engine, attemptId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => request(engine, { attemptId }, { signal }),
    refetchInterval: 750,
    refetchIntervalInBackground: true,
    gcTime: 0,
    retry: false,
  });
  const zh = language === "zh-CN";
  const openedQuestion = query.data?.find(
    (question) => question.mode === "url" && question.externalStatus === "opened",
  );
  const openedUrl = openedQuestion?.mode === "url" ? parseElicitationUrl(openedQuestion.url) : null;
  return (
    <>
      {openedUrl ? (
        <Button
          type="button"
          variant="link"
          onClick={() => {
            void Promise.resolve()
              .then(() => openExternalUrl(openedUrl.href))
              .catch(() => {
                setFailed(true);
              });
          }}
        >
          {zh ? "重新打开授权页" : "Reopen authorization page"}
        </Button>
      ) : null}
      {query.data
        ?.filter((question) => question !== openedQuestion)
        .map((question) => (
          <ElicitationRequestCard
            key={question.requestId}
            request={question}
            interactive={question.status === "pending"}
            openUrl={openExternalUrl}
            onError={() => {
              setFailed(true);
            }}
            onResolve={async (answer) => {
              setFailed(false);
              await cache.cancelQueries({ queryKey, exact: true });
              const remaining = await request(engine, {
                attemptId,
                requestId: question.requestId,
                resolution:
                  answer.action === "accept"
                    ? { action: "accept", content: answer.content ?? {} }
                    : { action: answer.action, content: null },
              });
              // 认证可能随答复结束，卸载后无需重建临时查询。
              cache.setQueryData(queryKey, (previous) =>
                previous === undefined ? undefined : remaining,
              );
            }}
            questionnaireLabels={{
              previous: zh ? "上一题" : "Previous",
              next: zh ? "下一题" : "Next",
              progress: (current, total) => `${String(current)}/${String(total)}`,
            }}
            labels={{
              title: zh
                ? `${question.serverName} 请求认证交互`
                : `Authentication request from ${question.serverName}`,
              submit: zh ? "提交" : "Submit",
              cancel: zh ? "取消" : "Cancel",
              decline: zh ? "拒绝" : "Decline",
              expired: zh ? "此请求已结束" : "Request expired",
              inactive: zh ? "此请求已处理" : "Request handled",
              unsupported: zh ? "此问卷格式不受支持" : "Unsupported questionnaire",
              open: zh ? "同意并打开" : "Accept and open",
              domain: zh ? "目标域名" : "Domain",
              url: zh ? "目标地址" : "URL",
              suspicious: zh ? "请确认该地址可信。" : "Check that you trust this address.",
              invalidUrl: zh ? "地址无效" : "Invalid URL",
              opened: zh
                ? "已打开，请在浏览器中完成认证"
                : "Opened. Finish authentication in your browser.",
              completed: zh ? "外部认证已完成" : "External authentication completed",
            }}
          />
        ))}
      {failed || query.isError ? (
        <p role="alert" className="py-2 text-label text-danger">
          {zh
            ? "认证问卷通信失败，请重试。"
            : "Could not communicate with the authentication form. Try again."}
        </p>
      ) : null}
    </>
  );
}
