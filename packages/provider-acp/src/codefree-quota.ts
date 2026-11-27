import type { SessionUpdate } from "@agentclientprotocol/sdk/unstable";
import type { CodefreeQuotaView } from "@codexly/protocol";

interface WindowUsage {
  period: "5H" | "7D";
  used?: number;
  limit?: number;
  usagePercent?: number;
  resetAt?: number;
}
export interface CodefreeQuotaFields {
  notification?: WindowUsage & { eventId: string };
  exhausted?: boolean;
  period?: WindowUsage["period"];
  periods?: WindowUsage["period"][];
  periodDetails?: WindowUsage[];
  used?: number;
  limit?: number;
  resetAt?: number;
}

const labels = { "5H": "5 小时", "7D": "周" };
const valid = (value?: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function describe(window: WindowUsage) {
  const fields = [];
  if (valid(window.usagePercent)) fields.push(`已用 ${String(window.usagePercent)}%`);
  if (valid(window.used)) fields.push(`已用 ${window.used.toLocaleString("zh-CN")} token`);
  if (valid(window.limit)) fields.push(`上限 ${window.limit.toLocaleString("zh-CN")} token`);
  if (valid(window.resetAt) && window.resetAt > 0) {
    const date = new Date(window.resetAt < 1e11 ? window.resetAt * 1000 : window.resetAt);
    if (Number.isFinite(date.getTime()))
      fields.push(`重置时间 ${date.toISOString().replace("T", " ").slice(0, 19)} UTC`);
  }
  return [labels[window.period] + "额度", ...fields].join(" · ");
}

/** 从供应商原生事件读取账号额度；可选的计数和重置时间仅在服务端实际提供时展示。 */
export function codefreeQuotaNotice(
  type: string,
  data: CodefreeQuotaFields,
): SessionUpdate | undefined {
  const warning = data.notification;
  if (type === "codefree.quota.warning" && warning && labels[warning.period]) {
    return {
      sessionUpdate: "notice",
      severity: data.exhausted ? "error" : "warning",
      title: "CodeFree O " + labels[warning.period] + (data.exhausted ? "额度已耗尽" : "额度预警"),
      description: describe(warning),
    };
  }
  if (type !== "codefree.quota.exhausted" || !data.period) return;
  // 双窗口可同时耗尽。顶层计数属于主窗口，避免误用到另一个周期。
  const periods = new Set([data.period, ...(data.periods ?? [])]);
  const lines = Array.from(periods)
    .filter((period) => labels[period])
    .map((period) =>
      describe({
        ...(period === data.period
          ? { used: data.used, limit: data.limit, resetAt: data.resetAt }
          : {}),
        ...data.periodDetails?.find((detail) => detail.period === period),
        period,
      }),
    );
  return {
    sessionUpdate: "notice",
    severity: "error",
    title: "CodeFree O 额度已耗尽",
    description: lines.join("\n"),
  };
}

interface QuotaMeter {
  usagePercent?: number;
}
export interface CodefreeQuotaSnapshot {
  quotaStatus?: string;
  statusReason?: string | null;
  sevenDay?: QuotaMeter | null;
  fiveHour?: QuotaMeter | null;
}

/** 原生 /usage 的进度条表示剩余量，服务端 usagePercent 表示已用量。空窗口保留为未知。 */
export function quotaView(snapshot: CodefreeQuotaSnapshot): CodefreeQuotaView {
  const remaining = (meter?: QuotaMeter | null) => {
    const used = meter?.usagePercent;
    return typeof used === "number" && Number.isFinite(used)
      ? Math.min(100, Math.max(0, 100 - used))
      : null;
  };
  return {
    fiveHour: remaining(snapshot.fiveHour),
    sevenDay: remaining(snapshot.sevenDay),
    reason: typeof snapshot.statusReason === "string" ? snapshot.statusReason : null,
  };
}
export function quotaSummary(snapshot: CodefreeQuotaSnapshot) {
  const reasons: Record<string, string> = {
    OUTSIDE_GRAY_SCOPE: "当前账号未纳入额度灰度范围",
    OUTSIDE_WORK_TIME: "当前不在额度限制时段",
    VIP: "当前账号享有额度豁免",
    CONFIG_UNAVAILABLE: "额度配置暂不可用",
  };
  const reason = snapshot.statusReason;
  const lines: string[] = reason ? [reasons[reason] ?? reason] : [];
  const view = quotaView(snapshot);
  for (const [label, remaining] of [
    ["周", view.sevenDay],
    ["5 小时", view.fiveHour],
  ] as const) {
    if (remaining !== null) {
      lines.push(`${label}额度剩余 ${remaining.toLocaleString("zh-CN")}%`);
    } else if (!reason) lines.push(`${label}额度暂无数据`);
  }
  return lines.join("\n");
}
