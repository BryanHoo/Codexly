import { PersonalizationInstructionsEditor } from "@codexly/ui/core/personalization-instructions-editor";
import { SettingsMutationStatus } from "@codexly/ui/core/settings-mutation-status";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSettingsAutosave } from "@codexly/ui/core/use-settings-autosave";
import { SettingsSaveStatus } from "@codexly/ui/core/settings-save-status";
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

export function PersonalizationSettingsPanel({ client = nativeClient }: Readonly<{ client?: PersonalizationClient }>) {
  const { t } = useTranslation("settings");
  const cache = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savedContent = useRef<string | undefined>(undefined);
  // 面板挂载时才读取；编辑期间不自动刷新，避免原文基线被外部更新替换。
  const instructions = useQuery({ queryKey: instructionsKey, queryFn: () => client.getGlobalInstructions(), refetchOnWindowFocus: false });
  const memories = useQuery({ queryKey: memoriesKey, queryFn: () => client.getMemorySettings() });
  const save = useMutation({
    mutationFn: ({ content, expectedContent }: { content: string; expectedContent: string }) => client.saveGlobalInstructions(content, expectedContent),
    onSuccess: (result) => { cache.setQueryData(instructionsKey, result); savedContent.current = result.content; },
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
  const autosave = useSettingsAutosave<string>(async (content) => {
    const expectedContent = savedContent.current ?? instructions.data?.content;
    if (expectedContent === undefined || content === expectedContent) return;
    // 串行请求使用上次保存结果作为基线，继续输入时不会误触发文件冲突。
    await save.mutateAsync({ content, expectedContent });
  });
  const content = draft ?? instructions.data?.content ?? "";
  const memoryBusy = memoryUpdate.isPending || reset.isPending;
  const conflict = save.error !== null && "code" in save.error && save.error.code === "GLOBAL_INSTRUCTIONS_CHANGED";
  return (
    <section id="settings-panel-personalization" className="space-y-8">
      <h1 className="text-xl font-semibold">{t("sections.personalization")}</h1>
      <SettingsSaveStatus beforeLeave={() => autosave.queue.flush()} status={conflict ? "idle" : autosave.status} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => { void autosave.queue.retry(); }} />
      <PersonalizationInstructionsEditor
        id="codex-global-instructions"
        label={t("personalization.instructions")}
        description={
          <>
            {t("personalization.description")}
            {instructions.data ? (
              <span className="block break-all">
                {t("personalization.fileLocation", { path: instructions.data.path })}
              </span>
            ) : null}
          </>
        }
        beforeEditor={
          <>
            {instructions.isError ? <p role="alert" className="text-body-small text-danger">{t("personalization.loadError")}</p> : null}
            {instructions.isPending ? <p role="status">{t("loading")}</p> : null}
          </>
        }
        onBlur={() => { void autosave.queue.flush(); }}
        disabled={instructions.data === undefined || instructions.isFetching}
        value={content}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          autosave.queue.schedule(event.currentTarget.value);
          save.reset();
        }}
      >
        {instructions.data?.overrideActive ? <p className="text-body-small text-muted-foreground">{t("personalization.override")}</p> : null}
        {conflict ? <p role="alert" className="text-body-small text-danger">{t("personalization.conflict")}</p> : null}
        {instructions.isError || conflict ? <Button type="button" variant="ghost" disabled={instructions.isFetching || save.isPending} onClick={() => { void instructions.refetch().then((result) => { if (result.isSuccess) { autosave.queue.discard();
                  setDraft(null); savedContent.current = result.data.content; save.reset(); } }); }}>{t("personalization.reload")}</Button> : null}
      </PersonalizationInstructionsEditor>
      <div className="space-y-3">
        <SettingsMutationStatus mutation={memoryUpdate} labels={{ saving: t("actions.saving"), saved: t("actions.saved"), saveError: t("errors.save"), retry: t("common:actions.retry") }} onRetry={() => { if (memoryUpdate.variables) memoryUpdate.mutate(memoryUpdate.variables); }} />
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
