import type { GitRemoteState } from "@codexly/protocol";

/** Git 传输地址不能直接交给浏览器；统一转换为 HTTP(S)，并移除认证信息。 */
export function getGitRepositoryWebUrl(remote: string): string | null {
  const value = remote.trim();
  if (!value || /^[a-z]:[\\/]/i.test(value) || /^(?:javascript|data|file|vbscript):/i.test(value))
    return null;
  const scp = !value.includes("://") ? /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value) : null;
  try {
    const url = new URL(scp ? `ssh://${scp[1] ?? ""}/${scp[2] ?? ""}` : value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null;
    // SSH 的端口服务于 Git 传输，不能复用为网页端口；HTTP(S) 自定义端口保持原样。
    if (url.protocol === "ssh:" || url.protocol === "git:") {
      // URL 不允许直接从非特殊协议切换为 HTTPS，重新构造网页地址。
      return getGitRepositoryWebUrl(`https://${url.hostname}${url.pathname}`);
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
    return url.pathname === "/" || url.pathname === "" ? null : url.href;
  } catch {
    return null;
  }
}

/** 优先当前分支使用的远端，再回退 origin 和首个远端，避免多远端项目跳错仓库。 */
export function selectGitRepositoryWebUrl(
  state: Pick<GitRemoteState, "remote" | "remotes"> | undefined,
): string | null {
  const remote =
    state?.remotes.find((entry) => entry.name === state.remote) ??
    state?.remotes.find((entry) => entry.name === "origin") ??
    state?.remotes[0];
  return remote ? getGitRepositoryWebUrl(remote.url) : null;
}
