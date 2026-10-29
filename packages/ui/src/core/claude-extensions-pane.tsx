import { LoadingSkeleton } from "./loading-skeleton.js";
import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { useState, useDeferredValue, useRef } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { reconcileClaudeExtensionMutation } from "@codexly/frontend-core/claude-extension-cache";
import {
  ExtensionCatalogToolbar,
  ExtensionItem,
  ExtensionToggle,
  ExtensionRemoveDialog,
} from "./extension-catalog.js";
import { ExtensionList } from "./extension-list.js";
import {
  Blocks,
  Server,
  BadgeCheck,
  Download,
  Trash2,
  ArrowUpCircle,
  Info,
  LoaderCircle,
} from "lucide-react";
import type {
  ClaudeExtension,
  ClaudeExtensionClient,
  ClaudeExtensionKind,
  ClaudeExtensionMutation,
  ClaudeExtensionPage,
  ClaudeExtensionScope,
} from "@codexly/protocol";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";
import type { ExtensionTranslate } from "./extension-center-types.js";

const icons = { skills: Blocks, mcp: Server, plugins: BadgeCheck };

export function ClaudeExtensionsPane({
  client,
  kind,
  projectId,
  t,
}: Readonly<{
  client: ClaudeExtensionClient;
  kind: ClaudeExtensionKind;
  projectId?: string | undefined;
  t: ExtensionTranslate;
}>) {
  const queryClient = useQueryClient();
  const queryKey = ["extensions", "claude", kind, projectId ?? "global"];
  // 只查询当前栏目与范围；短期缓存和在途去重避免来回切换时反复启动官方 CLI。
  const result = useQuery({
    queryKey,
    queryFn: () => client.listClaudeExtensions(kind, projectId),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const page = result.data;
  const loading = result.isFetching;
  const [notice, setNotice] = useState(false);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [dialog, setDialog] = useState<ClaudeExtension | null>(null);
  const [filter, setFilter] = useState("all");
  const mutationKey = [...queryKey, "mutation"];
  const operations = useMutationState({
    filters: { mutationKey, status: "pending", exact: true },
    select: (operation) => operation.state.variables as ClaudeExtensionMutation | undefined,
  });
  const pendingIds = new Set(operations.map((operation) => operation?.id));
  // 同步登记可拦住同一帧的重复点击；不同插件仍可各自发起操作。
  const inFlight = useRef(new Set<string>());
  const [operationError, setOperationError] = useState<Error | null>(null);
  const mutation = useMutation({
    mutationKey,
    onMutate: () => {
      setOperationError(null);
      return queryClient.getQueryData<ClaudeExtensionPage>(queryKey);
    },
    onError: (error) => {
      setOperationError(error);
    },
    mutationFn: async (input: ClaudeExtensionMutation) => {
      // 先阻止旧读取回填缓存；写入结果始终归属发起操作时的范围。
      await queryClient.cancelQueries({ queryKey });
      return client.mutateClaudeExtension(input, projectId);
    },
    onSuccess: async (page, input, baseline) => {
      await queryClient.cancelQueries({ queryKey });
      // 插件可能同时提供 Skills、MCP；相关缓存失效后，进入栏目才重新读取。
      void queryClient.invalidateQueries({
        queryKey: ["extensions", "claude"],
        refetchType: "none",
      });
      queryClient.setQueryData<ClaudeExtensionPage>(queryKey, (previous) =>
        reconcileClaudeExtensionMutation(previous, page, input, baseline),
      );
      setNotice(true);
      setDialog((current) => (current?.id === input.id ? null : current));
    },
  });
  const cause = operationError ?? result.error;
  const error = cause
    ? cause instanceof Error
      ? cause.message
      : t("skillsMarket.center.operationError")
    : "";
  const refresh = () => {
    setOperationError(null);
    return result.refetch();
  };
  const mutate = async (input: ClaudeExtensionMutation) => {
    if (inFlight.current.has(input.id) || pendingIds.has(input.id)) return;
    inFlight.current.add(input.id);
    try {
      await mutation.mutateAsync(input);
    } catch {
      // 错误由 onError 展示，点击处理器不再产生未处理的 Promise 拒绝。
    } finally {
      inFlight.current.delete(input.id);
    }
  };
  const Icon = icons[kind];
  const rows = (page?.data ?? []).filter(
    (item) =>
      (!query || `${item.name} ${item.description}`.toLowerCase().includes(query)) &&
      (filter !== "installed" || item.installed) &&
      (filter !== "available" || !item.installed),
  );
  const actionScope = (item: ClaudeExtension): ClaudeExtensionScope =>
    kind === "skills"
      ? projectId
        ? "local"
        : "user"
      : ["project", "local"].includes(item.scope)
        ? (item.scope as ClaudeExtensionScope)
        : "user";
  return (
    <div className="skills-market-pane claude-extensions" aria-busy={loading}>
      <ExtensionCatalogToolbar
        search={search}
        onSearch={setSearch}
        count={page?.data.length ?? 0}
        loading={loading}
        onRefresh={() => void refresh()}
        t={t}
        {...(kind === "plugins"
          ? {
              filter,
              onFilter: setFilter,
              syncing: pendingIds.has("claude-plugins-official"),
              onSync: () =>
                void mutate({ kind, action: "sync", id: "claude-plugins-official", scope: "user" }),
            }
          : {})}
      />
      {error ? (
        <div className="extension-center__message" role="alert">
          <Info aria-hidden="true" />
          <span>{error}</span>
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void refresh()}>
            {t("skillsMarket.center.retry")}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div className="extension-center__message" role="status">
          <Info aria-hidden="true" />
          {t("skillsMarket.center.sessionHint")}
        </div>
      ) : null}
      {loading && !page ? (
        <LoadingSkeleton label={t("skillsMarket.loadingExtension")} />
      ) : rows.length ? (
        <ExtensionList
          items={rows}
          renderItem={(item) => (
            <ExtensionItem
              key={`${item.id}:${item.scope}`}
              kind={kind}
              name={item.name}
              description={
                item.description ||
                (kind === "plugins"
                  ? t("skillsMarket.center.officialCatalog")
                  : (formatDisplayPath(item.path) ?? "MCP"))
              }
              hint={
                formatDisplayPath(item.path) ??
                (item.description || t("skillsMarket.center.officialCatalog"))
              }
              scopeLabel={t(
                `skillsMarket.center.${item.scope === "user" ? "global" : item.scope === "project" ? "project" : item.scope === "local" ? "local" : "managed"}`,
              )}
              version={item.version}
              actions={
                <>
                  {kind === "plugins" && !item.installed ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingIds.has(item.id)}
                      aria-busy={pendingIds.has(item.id)}
                      onClick={() =>
                        void mutate({
                          kind,
                          action: "install",
                          id: item.id,
                          scope: projectId ? "project" : "user",
                        })
                      }
                    >
                      {pendingIds.has(item.id) ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Download aria-hidden="true" />
                      )}
                      {t("skillsMarket.installPlugin")}
                    </Button>
                  ) : null}
                  {item.installed && item.mutable ? (
                    <ExtensionToggle
                      checked={item.enabled}
                      disabled={pendingIds.has(item.id) || (kind === "mcp" && !projectId)}
                      label={t("skillsMarket.toggle", { name: item.name })}
                      hint={t(
                        kind === "mcp" && !projectId
                          ? "skillsMarket.center.selectProject"
                          : "skillsMarket.toggle",
                        { name: item.name },
                      )}
                      onChange={(enabled) =>
                        void mutate({
                          kind,
                          action: enabled ? "enable" : "disable",
                          id: item.id,
                          scope: actionScope(item),
                        })
                      }
                    />
                  ) : null}
                  {kind === "plugins" && item.installed && item.mutable ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"

                          aria-label={`${t("skillsMarket.center.update")} ${item.name}`}
                          disabled={pendingIds.has(item.id)}
                          onClick={() =>
                            void mutate({
                              kind,
                              action: "update",
                              id: item.id,
                              scope: actionScope(item),
                            })
                          }
                        >
                          <ArrowUpCircle />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("skillsMarket.center.update")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  {item.installed && item.mutable && kind !== "skills" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"

                          aria-label={`${t("skillsMarket.center.remove")} ${item.name}`}
                          disabled={pendingIds.has(item.id)}
                          onClick={() => {
                            setDialog(item);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("skillsMarket.center.remove")}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </>
              }
            />
          )}
        />
      ) : !loading && !error ? (
        <div className="extension-empty">
          <Icon aria-hidden="true" />
          <h4>
            {t(
              query
                ? "skillsMarket.center.noResults"
                : `skillsMarket.${kind === "skills" ? "emptyInstalled" : kind === "mcp" ? "emptyMcp" : "emptyPlugins"}`,
            )}
          </h4>
          <p>{t(query ? "skillsMarket.center.searchHint" : `skillsMarket.center.empty${kind}`)}</p>
          {kind === "plugins" ? (
            <Button
              variant="outline"
              disabled={pendingIds.has("claude-plugins-official")}
              onClick={() =>
                void mutate({ kind, action: "sync", id: "claude-plugins-official", scope: "user" })
              }
            >
              {t("skillsMarket.center.syncCatalog")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {dialog ? (
        <ExtensionRemoveDialog
          name={dialog.name}
          pending={pendingIds.has(dialog.id)}
          error={error}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() =>
            void mutate({
              kind,
              action: kind === "plugins" ? "uninstall" : "remove",
              id: dialog.id,
              scope: actionScope(dialog),
            })
          }
          t={t}
        />
      ) : null}
    </div>
  );
}
