import type { WorkbenchPetDescriptor, WorkbenchPetSettings } from "@codexly/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, PawPrint, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import {
  downloadWorkbenchPetMutationOptions,
  petCatalogQueryOptions,
} from "../pet-catalog-query.js";
import { WorkbenchPetCanvas } from "./workbench-pet-canvas.js";

const EMPTY_PETS: readonly WorkbenchPetDescriptor[] = [];

export function resolveEnabledPetSettings(
  settings: WorkbenchPetSettings,
  pets: readonly WorkbenchPetDescriptor[],
): WorkbenchPetSettings {
  const selectedPetId =
    pets.find((pet) => pet.id === settings.selectedPetId)?.id ??
    pets.find((pet) => pet.id === "codex")?.id ??
    pets[0]?.id;
  return selectedPetId === undefined
    ? { enabled: false, selectedPetId: settings.selectedPetId }
    : { enabled: true, selectedPetId };
}

type GlobalSettingsPetsViewProps = Readonly<{
  error: Error | null;
  isLoading: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onPetSelect: (petId: string) => void;
  onRefresh: () => void;
  pets: readonly WorkbenchPetDescriptor[];
  settings: WorkbenchPetSettings;
}>;

function PetPreview({ pet }: Readonly<{ pet: WorkbenchPetDescriptor }>) {
  if (pet.availability !== "ready") {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-control bg-control text-muted-foreground">
        <PawPrint aria-hidden="true" className="size-5" />
      </span>
    );
  }
  return (
    <span className="size-12 shrink-0 overflow-hidden" aria-hidden="true">
      <WorkbenchPetCanvas animationName="idle" pet={pet} />
    </span>
  );
}

export function GlobalSettingsPetsView({
  error,
  isLoading,
  onEnabledChange,
  onPetSelect,
  onRefresh,
  pets,
  settings,
}: GlobalSettingsPetsViewProps) {
  const { t } = useTranslation("settings");
  return (
    <section id="settings-panel-pets">
      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
        <h3 className="text-heading font-semibold">{t("sections.pets")}</h3>
        <Button onClick={onRefresh} size="sm" type="button" variant="ghost">
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          {t("pets.refresh")}
        </Button>
      </div>
      <label className="flex min-h-12 items-center justify-between gap-3 border-b border-separator py-3 text-body-small font-medium">
        <span>{t("pets.enabled")}</span>
        <Checkbox
          aria-label={t("pets.enabled")}
          checked={settings.enabled}
          disabled={isLoading || pets.length === 0}
          onCheckedChange={(checked) => {
            onEnabledChange(checked === true);
          }}
        />
      </label>
      {isLoading ? (
        <p
          className="grid min-h-36 place-items-center text-body-small text-muted-foreground"
          role="status"
        >
          {t("pets.loading")}
        </p>
      ) : error !== null && pets.length === 0 ? (
        <div className="grid min-h-36 place-items-center gap-3 py-5 text-center" role="alert">
          <p className="text-body-small text-danger">{t("pets.errors.load")}</p>
          <Button onClick={onRefresh} size="sm" type="button" variant="outline">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {t("common:actions.retry")}
          </Button>
        </div>
      ) : (
        <>
          {error === null ? null : (
            <p className="mt-3 text-body-small text-danger" role="alert">
              {t("pets.errors.load")}
            </p>
          )}
          <div
            aria-label={t("pets.selectionLabel")}
            className="grid gap-2 py-4 sm:grid-cols-2"
            role="radiogroup"
          >
            {pets.map((pet) => {
              const selected = settings.selectedPetId === pet.id;
              return (
                <Button
                  aria-checked={selected}
                  className={`h-auto min-w-0 items-center justify-start gap-3 whitespace-normal border p-3 text-left ${selected ? "border-brand bg-control-active text-foreground" : "border-separator-strong bg-panel text-foreground"}`}
                  key={pet.id}
                  onClick={() => {
                    onPetSelect(pet.id);
                  }}
                  role="radio"
                  type="button"
                  variant="ghost"
                >
                  <PetPreview pet={pet} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{pet.displayName}</span>
                    <span className="mt-0.5 line-clamp-2 block text-label text-muted-foreground">
                      {pet.description}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-label text-muted-foreground">
                      {pet.availability === "ready" ? null : (
                        <Download aria-hidden="true" className="size-3" />
                      )}
                      {t(`pets.availability.${pet.availability}`)}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function GlobalSettingsPets({
  onChange,
  settings,
}: Readonly<{
  onChange: (settings: WorkbenchPetSettings) => void;
  settings: WorkbenchPetSettings;
}>) {
  const queryClient = useQueryClient();
  const catalog = useQuery(petCatalogQueryOptions());
  const download = useMutation(downloadWorkbenchPetMutationOptions(queryClient));
  const pets = catalog.data?.data ?? EMPTY_PETS;
  const requestedDownloadsRef = useRef(new Set<string>());
  const mutateDownload = download.mutate;
  const ensurePetDownload = useCallback(
    (petId: string) => {
      if (requestedDownloadsRef.current.has(petId)) return;
      requestedDownloadsRef.current.add(petId);
      mutateDownload(petId, {
        onError: () => {
          requestedDownloadsRef.current.delete(petId);
        },
      });
    },
    [mutateDownload],
  );

  useEffect(() => {
    // 进入目录即在后台准备预览资源，选择和保存不等待下载完成。
    for (const pet of pets) {
      if (pet.availability === "downloadable") ensurePetDownload(pet.id);
    }
  }, [ensurePetDownload, pets]);

  const selectAndDownload = (petId: string, enabled = settings.enabled) => {
    const pet = pets.find((candidate) => candidate.id === petId);
    onChange(
      enabled ? { enabled: true, selectedPetId: petId } : { enabled: false, selectedPetId: petId },
    );
    if (pet?.availability === "downloadable") ensurePetDownload(petId);
  };

  return (
    <GlobalSettingsPetsView
      error={catalog.error ?? download.error}
      isLoading={catalog.isPending}
      onEnabledChange={(enabled) => {
        if (!enabled) {
          onChange({ enabled: false, selectedPetId: settings.selectedPetId });
          return;
        }
        const next = resolveEnabledPetSettings(settings, pets);
        if (next.enabled) selectAndDownload(next.selectedPetId, true);
      }}
      onPetSelect={selectAndDownload}
      onRefresh={() => {
        void catalog.refetch();
      }}
      pets={pets}
      settings={settings}
    />
  );
}
