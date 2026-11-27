import type { AcpAgentProfile, AcpConfigOption } from "@codexly/protocol";

/** 订阅型引擎必须确认账号登录。其他 ACP 可能不公布身份，但明确的 API 覆盖或未登录状态始终优先。 */
export function canShowAcpQuota(profile: AcpAgentProfile): boolean {
  if (profile.connection) return false;
  const kind = profile.authStatus?.kind;
  if (
    profile.engine === "codex" ||
    profile.engine === "claude" ||
    profile.engine === "acp-codefree-o"
  ) {
    return kind === "account";
  }
  return kind !== "none" && kind !== "api_key" && kind !== "gateway";
}

export function canShowAcpFastMode(profile: AcpAgentProfile | undefined): boolean {
  return (
    profile?.engine === "codex" && profile.authStatus?.kind === "account" && !profile.connection
  );
}

export function isAcpFastModeOption(option: AcpConfigOption): boolean {
  return /^(fast[-_]?mode|service[-_]?tier)$/iu.test(option.id);
}
