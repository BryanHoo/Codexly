import type { WorkbenchPetSettings } from "../../../protocol/index.js";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { configureDesktopPet } from "../../../platform/tauri/desktop-pet-client.js";
import { petCatalogQueryOptions } from "../pet-catalog-query.js";

function DesktopPetConfiguration({ petId }: Readonly<{ petId: string | null }>) {
  useEffect(() => {
    // WebView 只选择宠物，任务状态和动画由 Rust 统一活动状态生成。
    void configureDesktopPet(petId).catch(() => undefined);
  }, [petId]);
  return null;
}

function EnabledDesktopPet({ settings }: Readonly<{ settings: WorkbenchPetSettings }>) {
  const catalog = useQuery(petCatalogQueryOptions());
  const available = catalog.data?.data.some(
    (pet) => pet.id === settings.selectedPetId && pet.availability === "ready",
  );

  return <DesktopPetConfiguration petId={available === true ? settings.selectedPetId : null} />;
}

export function WorkbenchPetLayer({
  settings,
}: Readonly<{ settings: WorkbenchPetSettings | undefined }>) {
  if (settings?.enabled !== true) return <DesktopPetConfiguration petId={null} />;
  return <EnabledDesktopPet settings={settings} />;
}
