import type {
  PendingRequest,
  PermissionApprovalResolution,
  ResolvePendingRequestRequest,
} from "@codexly/protocol";
import { useEffect, useRef, useState } from "react";
import { v4 as createUuid } from "uuid";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationState,
} from "../../../shared/components/agent/confirmation.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";

type PermissionRequest = Extract<PendingRequest, { type: "permissions_approval" }>;
type PermissionCategory = PermissionApprovalResolution["grantedPermissions"][number];
type PendingRequestResolution = ResolvePendingRequestRequest["resolution"];

type PermissionApprovalRequestCardProps = Readonly<{
  interactive: boolean;
  onResolve: (
    request: PermissionRequest,
    resolution: PendingRequestResolution,
    idempotencyKey: string,
  ) => Promise<void>;
  request: PermissionRequest;
}>;

const permissionCategoryOrder: readonly PermissionCategory[] = ["network", "file_system"];

export function createPermissionApprovalResolution(
  grantedPermissions: readonly PermissionCategory[],
  scope: PermissionApprovalResolution["scope"],
): PermissionApprovalResolution {
  const selected = new Set(grantedPermissions);
  return {
    grantedPermissions: permissionCategoryOrder.filter((category) => selected.has(category)),
    scope,
  };
}

function approvalState(request: PermissionRequest, submitting: boolean): ConfirmationState {
  if (request.status === "expired") return "approval-expired";
  if (request.status === "resolved") return "approval-resolved";
  return submitting ? "approval-submitting" : "approval-requested";
}

function requestedCategories(request: PermissionRequest): PermissionCategory[] {
  return permissionCategoryOrder.filter((category) =>
    category === "network"
      ? request.permissions.network !== null
      : request.permissions.fileSystem !== null,
  );
}

function PermissionPath({
  path,
}: Readonly<{
  path: NonNullable<PermissionRequest["permissions"]["fileSystem"]>["entries"][number]["path"];
}>) {
  const { t } = useTranslation("workbench");
  if (path.type === "path" || path.type === "glob") return path.value;
  const label =
    path.kind === "root"
      ? t("pending.permissionRoot")
      : path.kind === "minimal"
        ? t("pending.permissionMinimal")
        : path.kind === "project_roots"
          ? t("pending.permissionProjectRoots")
          : path.kind === "tmpdir"
            ? t("pending.permissionTmpdir")
            : path.kind === "slash_tmp"
              ? "/tmp"
              : (path.path ?? t("pending.permissionUnknownPath"));
  return path.subpath === null || path.subpath.length === 0 ? label : `${label}/${path.subpath}`;
}

export function FileSystemPermissionDetails({
  permissions,
}: Readonly<{
  permissions: NonNullable<PermissionRequest["permissions"]["fileSystem"]>;
}>) {
  const { t } = useTranslation("workbench");
  const rows = [
    ...(permissions.read ?? []).map((path) => ({ access: "read" as const, path })),
    ...(permissions.write ?? []).map((path) => ({ access: "write" as const, path })),
  ];
  return (
    <div className="mt-2 space-y-1 pl-6 font-mono text-meta text-muted-foreground">
      {rows.map((row, index) => (
        <div className="break-all" key={`${row.access}:${row.path}:${String(index)}`}>
          <span className="font-sans font-medium text-foreground">
            {t(`pending.permissionAccess.${row.access}`)}
          </span>{" "}
          {row.path}
        </div>
      ))}
      {permissions.entries.map((entry, index) => (
        <div className="break-all" key={`${entry.access}:${String(index)}`}>
          <span className="font-sans font-medium text-foreground">
            {t(`pending.permissionAccess.${entry.access}`)}
          </span>{" "}
          <PermissionPath path={entry.path} />
        </div>
      ))}
      {permissions.globScanMaxDepth === null ? null : (
        <div className="font-sans">
          {t("pending.permissionGlobDepth", { depth: permissions.globScanMaxDepth })}
        </div>
      )}
    </div>
  );
}

export function PermissionApprovalRequestCard({
  interactive,
  onResolve,
  request,
}: PermissionApprovalRequestCardProps) {
  const { t } = useTranslation("workbench");
  const available = requestedCategories(request);
  const [selected, setSelected] = useState<ReadonlySet<PermissionCategory>>(
    () => new Set(available),
  );
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<Readonly<{ fingerprint: string; key: string }>>();
  const allowButtonRef = useRef<HTMLButtonElement>(null);
  const resolutionLockRef = useRef(createAsyncActionLock());
  const canSubmit = interactive && request.status === "pending" && !submitting;
  const canAllow = canSubmit && selected.size > 0;

  useEffect(() => {
    if (canAllow) allowButtonRef.current?.focus();
  }, [canAllow, request.requestId]);

  const resolve = (scope: PermissionApprovalResolution["scope"] | "deny") =>
    resolutionLockRef.current.run(async () => {
      if (!canSubmit || (scope !== "deny" && selected.size === 0)) return;
      const resolution = createPermissionApprovalResolution(
        scope === "deny" ? [] : [...selected],
        scope === "deny" ? "turn" : scope,
      );
      // 固定权限类别顺序，确保同一授权子集重试时复用相同幂等指纹。
      const fingerprint = JSON.stringify(resolution);
      const nextAttempt =
        attempt?.fingerprint === fingerprint ? attempt : { fingerprint, key: createUuid() };
      setAttempt(nextAttempt);
      setSubmitting(true);
      try {
        await onResolve(request, resolution, nextAttempt.key);
        notifyActionSuccess();
      } catch (error) {
        notifyActionError(error);
        setSubmitting(false);
      }
    });

  const toggleCategory = (category: PermissionCategory, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(category);
      else next.delete(category);
      return next;
    });
  };

  return (
    <Confirmation approval={{ id: request.requestId }} state={approvalState(request, submitting)}>
      <ConfirmationTitle>{t("pending.permissionApproval")}</ConfirmationTitle>
      <ConfirmationRequest>
        <div className="space-y-3">
          {request.permissions.network === null ? null : (
            <div>
              <div className="flex items-center gap-2">
                <Checkbox
                  aria-label={t("pending.networkPermission")}
                  checked={selected.has("network")}
                  disabled={!canSubmit}
                  id={`${request.requestId}-network`}
                  onCheckedChange={(checked) => {
                    toggleCategory("network", checked === true);
                  }}
                />
                <label className="font-medium" htmlFor={`${request.requestId}-network`}>
                  {t("pending.networkPermission")}
                </label>
              </div>
            </div>
          )}
          {request.permissions.fileSystem === null ? null : (
            <div>
              <div className="flex items-center gap-2">
                <Checkbox
                  aria-label={t("pending.fileSystemPermission")}
                  checked={selected.has("file_system")}
                  disabled={!canSubmit}
                  id={`${request.requestId}-file-system`}
                  onCheckedChange={(checked) => {
                    toggleCategory("file_system", checked === true);
                  }}
                />
                <label className="font-medium" htmlFor={`${request.requestId}-file-system`}>
                  {t("pending.fileSystemPermission")}
                </label>
              </div>
              <FileSystemPermissionDetails permissions={request.permissions.fileSystem} />
            </div>
          )}
        </div>
        {request.reason === null ? null : (
          <p className="mt-2 text-label text-muted-foreground">{request.reason}</p>
        )}
      </ConfirmationRequest>
      {request.status === "expired" ? (
        <ConfirmationRejected>{t("pending.expired")}</ConfirmationRejected>
      ) : (
        <>
          {!interactive ? (
            <p className="mt-2 text-label text-muted-foreground">{t("pending.previousPending")}</p>
          ) : null}
          <ConfirmationActions>
            <ConfirmationAction
              disabled={!canSubmit}
              onClick={() => void resolve("deny")}
              tone="danger"
            >
              {t("pending.deny")}
            </ConfirmationAction>
            <ConfirmationAction disabled={!canAllow} onClick={() => void resolve("session")}>
              {t("pending.allowSession")}
            </ConfirmationAction>
            <ConfirmationAction
              disabled={!canAllow}
              onClick={() => void resolve("turn")}
              ref={allowButtonRef}
              tone="primary"
            >
              {t("pending.allowTurn")}
            </ConfirmationAction>
          </ConfirmationActions>
        </>
      )}
    </Confirmation>
  );
}
