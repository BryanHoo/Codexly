import { useEffect, useEffectEvent, useState } from "react";
import { Gauge } from "lucide-react";
import { canShowAcpQuota } from "@codexly/frontend-core/acp-config-visibility";
import { AcpProfileGate, type AcpProfileClient } from "./acp-fast-mode-gate.js";
import { Popover } from "radix-ui";
import type { AgentEngine, AgentQuotaView } from "@codexly/protocol";
import { Button } from "./button.js";
import { Progress } from "./progress.js";
import { toast } from "./notifications.js";

export interface QuotaClient extends AcpProfileClient {
  getAgentQuota?(engine: AgentEngine, options: { signal: AbortSignal }): Promise<AgentQuotaView>;
}
const reasons: Record<string, [string, string]> = {
  UNSUPPORTED: [
    "此 Agent 尚未提供可查询的账号额度",
    "Account quota is unavailable for this agent.",
  ],
  LOGIN_REQUIRED: [
    "请登录订阅账号以查看额度",
    "Sign in with a subscription account to view quota.",
  ],
  NO_ACCOUNT_LIMITS: ["当前账号未返回订阅额度", "No subscription quota was reported."],
  CLI_UNAVAILABLE: ["未找到此 Agent 的原生 CLI", "The native CLI is unavailable."],
  OUTSIDE_GRAY_SCOPE: [
    "当前账号未纳入额度灰度范围",
    "Quota limits are not enabled for this account.",
  ],
  OUTSIDE_WORK_TIME: ["当前不在额度限制时段", "Outside the quota enforcement period."],
  VIP: ["当前账号享有额度豁免", "This account is exempt from quota limits."],
  CONFIG_UNAVAILABLE: ["额度配置暂不可用", "Quota configuration is unavailable."],
};

function QuotaDetails({
  client,
  zh,
  engine,
}: {
  client: QuotaClient;
  zh: boolean;
  engine: AgentEngine;
}) {
  const [quota, setQuota] = useState<AgentQuotaView>();
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  // 错误提示使用当前界面语言，切换语言不应取消并重启账号查询。
  const reportFailure = useEffectEvent(() => {
    toast.error(zh ? "读取 Agent 额度失败" : "Could not read agent quota");
  });
  useEffect(() => {
    const controller = new AbortController();
    // 弹层挂载后才读账号额度。关闭或切换引擎会取消请求，迟到结果不会覆盖下次查询。
    const load = async () => {
      try {
        if (!client.getAgentQuota) throw new Error("Quota unavailable");
        const next = await client.getAgentQuota(engine, { signal: controller.signal });
        if (!controller.signal.aborted) setQuota(next);
      } catch {
        if (controller.signal.aborted) return;
        setFailed(true);
        reportFailure();
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [client, attempt, engine]);
  if (failed)
    return (
      <Button
        type="button"
        variant="ghost"
        size="toolbar"
        onClick={() => {
          setFailed(false);
          retry((n) => n + 1);
        }}
      >
        {zh ? "重试" : "Retry"}
      </Button>
    );
  if (!quota)
    return (
      <span role="status" className="text-label text-muted-foreground">
        {zh ? "正在读取额度…" : "Loading quota…"}
      </span>
    );
  const reason = quota.reason ? reasons[quota.reason]?.[zh ? 0 : 1] : undefined;
  const defaultRows = [
    { label: zh ? "5 小时" : "5 hours", remaining: quota.fiveHour },
    { label: zh ? "7 天" : "7 days", remaining: quota.sevenDay },
  ];
  const rows =
    quota.meters === undefined
      ? defaultRows
      : [...defaultRows.filter((row) => row.remaining !== null), ...quota.meters];
  const meterLabels: Record<string, string> = {
    rolling: zh ? "5 小时" : "5 hours",
    weekly: zh ? "7 天" : "7 days",
    monthly: zh ? "月度" : "Monthly",
    premium_interactions: zh ? "月度高级请求" : "Monthly premium interactions",
    chat: zh ? "月度聊天" : "Monthly chat",
    completions: zh ? "月度补全" : "Monthly completions",
  };
  return (
    <>
      {rows.map((row) => {
        const { label, remaining: value } = row;
        const unlimited = "unlimited" in row && row.unlimited === true;
        const displayLabel = meterLabels[label] ?? label;
        return (
          <div key={label} className="space-y-1">
            <div className="flex justify-between gap-3 text-label">
              <span>{displayLabel}</span>
              <span className="tabular-nums text-muted-foreground">
                {unlimited
                  ? zh
                    ? "不限额"
                    : "Unlimited"
                  : value === null
                    ? zh
                      ? "暂无数据"
                      : "Unavailable"
                    : value.toLocaleString(zh ? "zh-CN" : "en-US") + "%"}
              </span>
            </div>
            {value === null ? null : <Progress value={value} aria-label={displayLabel} />}
          </div>
        );
      })}
      {reason && <p className="text-caption text-muted-foreground">{reason}</p>}
    </>
  );
}
export function AgentQuotaControl({
  client,
  language,
  engine,
}: {
  client: QuotaClient;
  language: string;
  engine: AgentEngine;
}) {
  const zh = language.startsWith("zh");
  const name =
    (
      {
        codex: "Codex",
        claude: "Claude",
        "acp-codefree-o": "CodeFree O",
        "acp-github-copilot-cli": "GitHub Copilot",
      } as Record<string, string>
    )[engine] ?? engine.replace(/^acp-/, "");
  const title = name + (zh ? " 剩余额度" : " remaining quota");
  const control = (
    <Popover.Root key={engine}>
      <Popover.Trigger asChild>
        <Button type="button" size="icon-toolbar" variant="ghost" aria-label={title} title={title}>
          <Gauge className="size-4.5" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label={title}
          data-floating-surface=""
          className="z-50 w-64 max-w-[calc(100vw-1rem)] space-y-2 rounded-surface border border-separator bg-panel p-3 text-foreground shadow-floating"
        >
          <div className="text-body-small font-medium">{title}</div>
          <QuotaDetails engine={engine} client={client} zh={zh} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
  if (!client.getAcpAgent || !client.getAgentQuota) return null;
  return (
    <AcpProfileGate engine={engine} client={client} visible={canShowAcpQuota}>
      {control}
    </AcpProfileGate>
  );
}
