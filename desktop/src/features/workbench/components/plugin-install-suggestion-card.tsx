import type { PendingRequest } from "@/protocol/index.js";
import { Boxes, Check, ExternalLink, MoreHorizontal, PackagePlus, PlugZap } from "lucide-react";
import { useRef, useState } from "react";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationState,
} from "../../../shared/components/agent/confirmation.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../../../shared/components/core/sheet.js";
import { useTranslation } from "../../../i18n/i18n.js";
import "../../../shared/styles/official-plugins.css";
import { openExternalUrl } from "../../../platform/tauri/external-url.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { notifyActionError, notifyActionSuccess } from "../../notifications/action-notifications.js";
import {
  resolvePendingRequestAttempt,
  type PendingRequestResolutionAttempt,
  type PendingRequestResolveHandler,
} from "./pending-request-resolution.js";

type PluginInstallSuggestion = Extract<PendingRequest, { type: "plugin_install_suggestion" }>;
type PluginInstallResolution = Readonly<{
  action: "accept" | "cancel" | "decline";
  suppressFuture?: boolean;
}>;

function stateFor(
  request: PluginInstallSuggestion,
  submitting: boolean,
): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function webUrl(value: string | null): URL | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function PluginInstallSuggestionCard({
  interactive,
  onResolve,
  request,
}: Readonly<{
  interactive: boolean;
  onResolve: PendingRequestResolveHandler;
  request: PluginInstallSuggestion;
}>) {
  const { t } = useTranslation("workbench");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [connectorOpened, setConnectorOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<PendingRequestResolutionAttempt>();
  const lockRef = useRef(createAsyncActionLock());
  const canSubmit = interactive && request.status === "pending" && !submitting;
  const connectorUrl = request.toolType === "connector" ? webUrl(request.installUrl) : null;
  const resolve = (resolution: PluginInstallResolution) =>
    lockRef.current.run(async () => {
      if (!canSubmit) return;
      const nextAttempt = resolvePendingRequestAttempt(attempt, resolution);
      setAttempt(nextAttempt);
      setSubmitting(true);
      try {
        await onResolve(request, resolution, nextAttempt.key);
        setDetailsOpen(false);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
        setSubmitting(false);
      }
    });
  const accept = () => {
    if (request.toolType !== "connector" || connectorOpened) {
      return resolve({ action: "accept" });
    }
    return lockRef.current.run(async () => {
      if (!canSubmit) return;
      setSubmitting(true);
      try {
        if (connectorUrl === null) throw new Error(t("pending.pluginInvalidInstallUrl"));
        await openExternalUrl(connectorUrl.href);
        setConnectorOpened(true);
      } catch (error) {
        notifyActionError(error);
      } finally {
        setSubmitting(false);
      }
    });
  };
  const primaryLabel =
    request.toolType === "connector"
      ? t(connectorOpened ? "pending.pluginConfirmContinue" : "pending.pluginOpenInstall")
      : t("pending.pluginInstallContinue");
  const PrimaryIcon = request.toolType === "connector"
    ? connectorOpened ? Check : ExternalLink
    : PackagePlus;

  return (
    <>
      <Confirmation
        approval={{ id: request.requestId }}
        className="plugin-install-suggestion"
        state={stateFor(request, submitting)}
      >
        <ConfirmationTitle>
          {t("pending.pluginInstallTitle", { name: request.pluginName })}
        </ConfirmationTitle>
        <ConfirmationRequest className="plugin-install-suggestion__request">
          <p>{request.suggestReason}</p>
          <span className="plugin-install-suggestion__facts">
            {request.toolType === "plugin" ? <Boxes aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
            {request.connectorCount > 0
              ? t("pending.pluginConnectorCount", { count: request.connectorCount })
              : t(`pending.pluginType.${request.toolType}`)}
          </span>
        </ConfirmationRequest>
        {request.status === "resolved" ? (
          <p className="mt-2 text-label text-muted-foreground">
            {t("pending.pluginInstalled")}
          </p>
        ) : (
          <ConfirmationActions className="items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("pending.pluginMore")}
                  disabled={!canSubmit}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void resolve({ action: "decline", suppressFuture: true })}>
                  {t("pending.pluginNeverSuggest")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmationAction onClick={() => void resolve({ action: "decline" })} disabled={!canSubmit}>
              {t("pending.pluginNotNow")}
            </ConfirmationAction>
            <ConfirmationAction onClick={() => setDetailsOpen(true)}>
              {t("pending.pluginDetails")}
            </ConfirmationAction>
            <ConfirmationAction
              disabled={!canSubmit || (request.toolType === "connector" && connectorUrl === null)}
              onClick={() => void accept()}
              tone="primary"
            >
              <PrimaryIcon aria-hidden="true" />
              {primaryLabel}
            </ConfirmationAction>
          </ConfirmationActions>
        )}
      </Confirmation>

      <Sheet onOpenChange={setDetailsOpen} open={detailsOpen}>
        <SheetContent closeLabel={t("pending.pluginClose")}>
          <SheetHeader className="border-b border-separator pr-12">
            <SheetTitle>{request.pluginName}</SheetTitle>
            <SheetDescription>{request.suggestReason}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <section>
              <h4 className="text-label font-semibold">{t("pending.pluginSource")}</h4>
              <p className="mt-1 break-all font-mono text-meta text-muted-foreground">
                {request.toolId}
              </p>
            </section>
            <section>
              <h4 className="text-label font-semibold">{t("pending.pluginIncludes")}</h4>
              <p className="mt-1 text-body-small text-muted-foreground">
                {request.connectorCount > 0
                  ? t("pending.pluginConnectorCount", { count: request.connectorCount })
                  : t(`pending.pluginType.${request.toolType}`)}
              </p>
            </section>
          </div>
          {request.status === "pending" ? (
            <SheetFooter className="official-plugin-sheet__footer plugin-install-suggestion__sheet-footer">
              <Button
                disabled={!canSubmit}
                onClick={() => void resolve({ action: "decline" })}
                type="button"
                variant="ghost"
              >
                {t("pending.pluginNotNow")}
              </Button>
              <Button
                disabled={!canSubmit || (request.toolType === "connector" && connectorUrl === null)}
                onClick={() => void accept()}
                type="button"
              >
                <PrimaryIcon aria-hidden="true" />
                {primaryLabel}
              </Button>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
