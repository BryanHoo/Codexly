import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { NativeClient } from "@/platform/native-client-contract.js";
import type { MemorySettingsUpdate } from "@/protocol/index.js";
import "../../../i18n/settings-personalization.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../../../shared/components/core/dialog.js";
import { nativeClient } from "../../projects/project-query-contracts.js";
import { notifyActionSuccess } from "../../notifications/action-notifications.js";
import { SettingsField, SettingsGroup } from "./global-settings-fields.js";

type PersonalizationClient = Pick<NativeClient, "getGlobalInstructions" | "saveGlobalInstructions" | "getMemorySettings" | "updateMemorySettings" | "resetMemories">;
const instructionsKey = ["personalization", "instructions"] as const;
const memoriesKey = ["personalization", "memories"] as const;

export function PersonalizationSettingsPanel({ client = nativeClient, commitSettings }: Readonly<{ client?: PersonalizationClient; commitSettings?: ReactNode }>) {
  const { t } = useTranslation("settings");
  const cache = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 面板挂载时才读取；编辑期间不自动刷新，避免原文基线被外部更新替换。
  const instructions = useQuery({ queryKey: instructionsKey, queryFn: () => client.getGlobalInstructions(), refetchOnWindowFocus: false });
  const memories = useQuery({ queryKey: memoriesKey, queryFn: () => client.getMemorySettings() });
  const save = useMutation({
    mutationFn: ({ content, expectedContent }: { content: string; expectedContent: string }) => client.saveGlobalInstructions(content, expectedContent),
    onSuccess: (result) => { cache.setQueryData(instructionsKey, result); setDraft(null); notifyActionSuccess(t("personalization.saved")); },
    meta: { actionNotification: false },
  });
  const memoryUpdate = useMutation({
    mutationFn: (update: MemorySettingsUpdate) => client.updateMemorySettings(update),
    onSuccess: (result) => { cache.setQueryData(memoriesKey, result); },
    meta: { actionNotification: false },
  });
  const reset = useMutation({
    mutationFn: () => client.resetMemories(),
    onSuccess: () => { setConfirmDelete(false); notifyActionSuccess(t("personalization.deleted")); },
    meta: { actionNotification: false },
  });
  const content = draft ?? instructions.data?.content ?? "";
  const memoryBusy = memoryUpdate.isPending || reset.isPending;
  const conflict = save.error !== null && "code" in save.error && save.error.code === "GLOBAL_INSTRUCTIONS_CHANGED";
  return (
    <section id="settings-panel-personalization" className="space-y-8">
      <h1 className="text-xl font-semibold">{t("sections.personalization")}</h1>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label className="text-body font-semibold" htmlFor="codex-global-instructions">{t("personalization.instructions")}</label>
            <p className="mt-1 text-body-small text-muted-foreground">
              {t("personalization.description")}
              {instructions.data ? <span className="block break-all">{t("personalization.fileLocation", { path: instructions.data.path })}</span> : null}
            </p>
          </div>
          <Button type="button" variant="secondary" className="shrink-0" disabled={instructions.data === undefined || instructions.isFetching || save.isPending || content === instructions.data.content}
            onClick={() => save.mutate({ content, expectedContent: instructions.data!.content })}>
            {t(save.isPending ? "personalization.saving" : "personalization.save")}
          </Button>
        </div>
        {instructions.isError ? <p role="alert" className="text-body-small text-danger">{t("personalization.loadError")}</p> : null}
        {instructions.isPending ? <p role="status">{t("loading")}</p> : null}
        <textarea id="codex-global-instructions" className="min-h-56 w-full resize-y rounded-control border border-separator bg-panel p-3 text-body-small focus:shadow-focus focus:outline-none"
          spellCheck={false} disabled={instructions.data === undefined || save.isPending || instructions.isFetching} value={content}
          onChange={(event) => { setDraft(event.currentTarget.value); save.reset(); }} />
        {instructions.data?.overrideActive ? <p className="text-body-small text-muted-foreground">{t("personalization.override")}</p> : null}
        {save.isError ? <p role="alert" className="text-body-small text-danger">{t(conflict ? "personalization.conflict" : "personalization.saveError")}</p> : null}
        {instructions.isError || conflict ? <Button type="button" variant="ghost" disabled={instructions.isFetching} onClick={() => { void instructions.refetch().then((result) => { if (result.isSuccess) { setDraft(null); save.reset(); } }); }}>{t("personalization.reload")}</Button> : null}
      </div>
      {commitSettings}
      <div className="space-y-3">
        <SettingsGroup title={t("personalization.memories")} description={t("personalization.memoryDescription")}>
          {(["enabled", "allowExternalContext"] as const).map((key) => {
            const label = t(key === "enabled" ? "personalization.enabled" : "personalization.external");
            const checked = memories.data?.[key] ?? false;
            return <SettingsField key={key} label={label} description={t(key === "enabled" ? "personalization.enabledDescription" : "personalization.externalDescription")}>
              <Button role="switch" aria-label={label} aria-checked={checked} disabled={!memories.data || memoryBusy} className={`h-6 w-10 rounded-pill p-0.5 ${checked ? "bg-brand hover:bg-brand" : "bg-control-hover"}`} variant="ghost" type="button" onClick={() => memoryUpdate.mutate({ [key]: !checked })}>
                <span className={`block size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-2" : "-translate-x-2"}`} />
              </Button>
            </SettingsField>;
          })}
          <SettingsField label={t("personalization.remove")} description={t("personalization.removeDescription")}>
            <Button aria-label={t("personalization.remove")} className="text-danger" type="button" variant="ghost" disabled={memoryBusy || !memories.data} onClick={() => { reset.reset(); setConfirmDelete(true); }}>{t("personalization.remove")}</Button>
          </SettingsField>
        </SettingsGroup>
        {memories.isError ? <div role="alert"><p>{t("personalization.loadError")}</p><Button variant="ghost" onClick={() => void memories.refetch()}>{t("common:actions.retry")}</Button></div> : null}
        {memoryUpdate.isError ? <p role="alert" className="text-body-small text-danger">{t("personalization.memoryError")}</p> : null}
      </div>
      <Dialog open={confirmDelete} onOpenChange={(open) => { if (!reset.isPending) setConfirmDelete(open); }}>
        <DialogContent>
          <DialogTitle>{t("personalization.remove")}</DialogTitle>
          <DialogDescription>{t("personalization.confirmDescription")}</DialogDescription>
          {reset.isError ? <p role="alert" className="text-danger">{t("personalization.memoryError")}</p> : null}
          <DialogFooter>
            <Button variant="ghost" disabled={reset.isPending} onClick={() => setConfirmDelete(false)}>{t("personalization.cancel")}</Button>
            <Button className="text-danger" variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>{t(reset.isPending ? "personalization.deleting" : "personalization.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
