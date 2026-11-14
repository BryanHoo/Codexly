import type { AcpAgentProfile, AcpConfigOption } from "@codexly/protocol";

/** 快速模式仅对 Codex 的官方账号连接开放；API 覆盖和未知身份均不显示。 */
export function canShowAcpFastMode(profile: AcpAgentProfile | undefined): boolean {
  return (
    profile?.engine === "codex" &&
    profile.authStatus?.kind === "account" &&
    profile.connection === undefined
  );
}
export function isAcpFastModeOption(option: AcpConfigOption): boolean {
  return /^(fast[-_]?mode|service[-_]?tier)$/iu.test(option.id);
}
