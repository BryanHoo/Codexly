import { useIsMutating, useQuery } from "@tanstack/react-query";
import type {
  ProjectGitStatus,
  PushProjectCommitsRequest,
  PushProjectCommitsResponse,
} from "@codexly/protocol";
import { isRootGitProject } from "@codexly/frontend-core/project-git-availability";
import { projectGitRemoteQueryOptions } from "@codexly/frontend-core/project-git-push";
import { selectGitRepositoryWebUrl } from "@codexly/frontend-core/git-repository-url";
import { ExternalLink } from "lucide-react";
import { ContextMenuItem } from "./context-menu.js";
import { DropdownMenuItem } from "./dropdown-menu.js";

export type RemoteRepositoryTarget = Readonly<{ projectId: string; rootPath: string }>;
interface Client {
  getProjectGitStatus(
    projectId: string,
    query: { rootPath: string },
    options: { signal: AbortSignal },
  ): Promise<ProjectGitStatus>;
  pushProjectCommits(
    projectId: string,
    rootPath: string,
    request: PushProjectCommitsRequest,
  ): Promise<PushProjectCommitsResponse>;
}

/** 菜单内容挂载后才读取本地远端信息；两个菜单与提交面板共用缓存，不轮询、不访问网络。 */
export function ProjectRemoteRepositoryMenuItem({
  client,
  label,
  onOpenUrl,
  target,
  variant,
}: {
  client: Client;
  label: string;
  onOpenUrl?: ((url: string) => void) | undefined;
  target: RemoteRepositoryTarget;
  variant: "context" | "dropdown";
}) {
  const { projectId, rootPath } = target;
  const status = useQuery({
    queryKey: ["projects", projectId, rootPath, "git-status"],
    queryFn: ({ signal }) => client.getProjectGitStatus(projectId, { rootPath }, { signal }),
    staleTime: 15_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const writing = useIsMutating({ mutationKey: ["projects", projectId, rootPath, "git"] }) > 0;
  const remote = useQuery({
    ...projectGitRemoteQueryOptions(
      projectId,
      rootPath,
      status.data?.branch ?? null,
      status.data?.snapshot ?? "",
      client,
      writing,
    ),
    enabled: isRootGitProject(status.data) && !writing,
  });
  if (!isRootGitProject(status.data)) return null;
  const url = selectGitRepositoryWebUrl(remote.data?.remoteState);
  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  const contents = (
    <>
      <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />
      <span>{label}</span>
    </>
  );
  if (!url) return <Item disabled>{contents}</Item>;
  // Web 使用真实链接保留用户激活，移动浏览器不会因异步查询而拦截新窗口。
  return onOpenUrl ? (
    <Item
      onSelect={() => {
        onOpenUrl(url);
      }}
    >
      {contents}
    </Item>
  ) : (
    <Item asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {contents}
      </a>
    </Item>
  );
}
