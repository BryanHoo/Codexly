import { useEffect, useRef, useState, useDeferredValue } from "react";
import {
  Blocks,
  Server,
  BadgeCheck,
  Search,
  RefreshCw,
  Download,
  Trash2,
  ArrowUpCircle,
  Info,
} from "lucide-react";
import { Switch } from "radix-ui";
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
import { Input } from "./input.js";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "./dialog.js";
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
  const [page, setPage] = useState<ClaudeExtensionPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(false);
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const [dialog, setDialog] = useState<ClaudeExtension | null>(null);
  const [filter, setFilter] = useState("all");
  const generation = useRef(0);
  const active = useRef(true);
  const refresh = async () => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await client.listClaudeExtensions(kind, projectId);
      if (active.current && generation.current === request) setPage(result);
    } catch (cause) {
      if (active.current && generation.current === request)
        setError(cause instanceof Error ? cause.message : t("skillsMarket.center.operationError"));
    } finally {
      if (active.current && generation.current === request) setLoading(false);
    }
  };
  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [client, kind, projectId]);
  const mutate = async (input: ClaudeExtensionMutation) => {
    if (pending) return;
    // 使先前的读取失效；旧范围的异步结果不得覆盖当前项目。
    generation.current++;
    setPending(true);
    setError("");
    try {
      const result = await client.mutateClaudeExtension(input, projectId);
      if (active.current) {
        setPage(result);
        setNotice(true);
        setDialog(null);
      }
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : t("skillsMarket.center.operationError"));
    } finally {
      if (active.current) {
        setPending(false);
        setLoading(false);
      }
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
    <div className="skills-market-pane claude-extensions" aria-busy={loading || pending}>
      <div className="skills-market-toolbar">
        <label className="extension-search">
          <Search aria-hidden="true" />
          <Input
            variant="embedded"
            aria-label={t("skillsMarket.center.search")}
            placeholder={t("skillsMarket.center.search")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        <div className="extension-center__actions">
          {kind === "plugins" ? (
            <Button
              variant="outline"
              disabled={pending || loading}
              onClick={() =>
                void mutate({ kind, action: "sync", id: "claude-plugins-official", scope: "user" })
              }
            >
              <Download />
              {t("skillsMarket.center.syncCatalog")}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("skillsMarket.center.refresh")}

                size="icon"
                variant="ghost"
                disabled={pending || loading}
                onClick={() => void refresh()}
              >
                <RefreshCw className={loading ? "animate-spin" : ""} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("skillsMarket.center.refresh")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="extension-center__list-meta">
        <span>{t("skillsMarket.center.count", { count: page?.data.length ?? 0 })}</span>
        {kind === "plugins" ? (
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" aria-label={t("skillsMarket.center.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="all">{t("skillsMarket.center.all")}</SelectItem>
              <SelectItem value="installed">{t("skillsMarket.installedPlugins")}</SelectItem>
              <SelectItem value="available">{t("skillsMarket.availablePlugins")}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {error ? (
        <div className="extension-center__message" role="alert">
          <Info aria-hidden="true" />
          <span>{error}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || loading}
            onClick={() => void refresh()}
          >
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
        <div className="skills-market-state" role="status">
          {t("skillsMarket.loadingExtension")}
        </div>
      ) : rows.length ? (
        <ul className="extension-list">
          {rows.map((item) => (
            <li key={`${item.id}:${item.scope}`} className="extension-item">
              <span className="skills-market-glyph" data-tone={kind}>
                <Icon aria-hidden="true" />
              </span>
              <div className="extension-item__body">
                <div className="extension-item__title">
                  <strong>{item.name}</strong>
                  <span className="extension-badge">
                    {t(
                      `skillsMarket.center.${item.scope === "user" ? "global" : item.scope === "project" ? "project" : item.scope === "local" ? "local" : "managed"}`,
                    )}
                  </span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {" "}
                    <p>
                      {item.description ||
                        (kind === "plugins"
                          ? t("skillsMarket.center.officialCatalog")
                          : (item.path ?? "MCP"))}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>
                    {item.path ?? (item.description || t("skillsMarket.center.officialCatalog"))}
                  </TooltipContent>
                </Tooltip>
                {item.version ? (
                  <div className="extension-item__version">v{item.version}</div>
                ) : null}
              </div>
              <div className="extension-item__actions">
                {kind === "plugins" && !item.installed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      void mutate({
                        kind,
                        action: "install",
                        id: item.id,
                        scope: projectId ? "project" : "user",
                      })
                    }
                  >
                    <Download />
                    {t("skillsMarket.installPlugin")}
                  </Button>
                ) : null}
                {item.installed && item.mutable ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Switch.Root
                          className="skills-switch"
                          aria-label={t("skillsMarket.toggle", { name: item.name })}
                          checked={item.enabled}
                          disabled={pending || (kind === "mcp" && !projectId)}
                          onCheckedChange={(enabled) =>
                            void mutate({
                              kind,
                              action: enabled ? "enable" : "disable",
                              id: item.id,
                              scope: actionScope(item),
                            })
                          }
                        >
                          <Switch.Thumb className="skills-switch__thumb" />
                        </Switch.Root>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t(
                        kind === "mcp" && !projectId
                          ? "skillsMarket.center.selectProject"
                          : "skillsMarket.toggle",
                        { name: item.name },
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {kind === "plugins" && item.installed && item.mutable ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"

                        aria-label={`${t("skillsMarket.center.update")} ${item.name}`}
                        disabled={pending}
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
                        disabled={pending}
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
              </div>
            </li>
          ))}
        </ul>
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
              disabled={pending}
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setDialog(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {t("skillsMarket.center.confirmRemove", { name: dialog.name })}
            </DialogTitle>
            <DialogDescription>{t("skillsMarket.center.removeHint")}</DialogDescription>
            {error ? <p role="alert">{error}</p> : null}
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDialog(null);
                }}
              >
                {t("skillsMarket.center.cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  void mutate({
                    kind,
                    action: kind === "plugins" ? "uninstall" : "remove",
                    id: dialog.id,
                    scope: actionScope(dialog),
                  })
                }
              >
                {t("skillsMarket.center.remove")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
