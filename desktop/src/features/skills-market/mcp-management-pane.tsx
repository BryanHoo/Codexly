import type { ConfiguredMcpServer } from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Server } from "lucide-react";
import { Switch } from "radix-ui";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { useProjectData } from "../projects/project-context.js";

export function McpManagementPane() {
  const { t } = useTranslation("workbench");
  const { client } = useProjectData();
  const queryClient = useQueryClient();
  const servers = useQuery({ queryFn: () => client.listConfiguredMcpServers(), queryKey: ["extensions", "mcp"] });
  const toggle = useMutation({ mutationFn: (server: ConfiguredMcpServer) => client.setMcpServerEnabled(server.name, !server.enabled), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["extensions", "mcp"] }) });
  return <div className="skills-market-pane" role="tabpanel"><div className="skills-market-toolbar"><span className="text-body-small text-muted-foreground">{t("skillsMarket.mcpCount", { count: servers.data?.data.length ?? 0 })}</span><Button aria-label={t("skillsMarket.refreshMcp")} disabled={servers.isFetching} onClick={() => void servers.refetch()} size="icon-sm" title={t("skillsMarket.refreshMcp")} type="button" variant="ghost"><RefreshCw className={servers.isFetching ? "animate-spin" : ""} aria-hidden="true" /></Button></div>{servers.isPending ? <div className="skills-market-state" role="status">{t("skillsMarket.loadingMcp")}</div> : servers.error !== null ? <div className="skills-market-state" role="alert">{t("skillsMarket.mcpError")}</div> : servers.data.data.length === 0 ? <div className="skills-market-state">{t("skillsMarket.emptyMcp")}</div> : <section className="skills-installed-group"><header><h3>MCP</h3><span>{servers.data.data.length}</span></header><ul>{servers.data.data.map((server) => <li className="skills-installed-row" key={server.name}><span className="skills-mcp-row__content"><span className="skills-market-glyph" data-tone="mcp" aria-hidden="true"><Server /></span><span className="min-w-0 flex-1"><strong className="block truncate text-body-small">{server.name}</strong><span className="skills-mcp-status" data-enabled={server.enabled}>{t(server.enabled ? "skillsMarket.mcpEnabled" : "skillsMarket.mcpStopped")}</span></span></span><Switch.Root aria-label={t("skillsMarket.toggleMcp", { name: server.name })} checked={server.enabled} className="skills-switch" disabled={toggle.isPending && toggle.variables?.name === server.name} onCheckedChange={() => toggle.mutate(server)}><Switch.Thumb className="skills-switch__thumb" /></Switch.Root></li>)}</ul></section>}</div>;
}
