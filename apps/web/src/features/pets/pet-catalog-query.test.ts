import type { WorkbenchPetDescriptor } from "@codexly/protocol";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import { createActionMutationCache } from "../notifications/action-notifications.js";
import { downloadWorkbenchPetMutationOptions, petCatalogQueryKey } from "./pet-catalog-query.js";

const downloadablePet: WorkbenchPetDescriptor = {
  animations: {},
  assetId: "a".repeat(64),
  availability: "downloadable",
  description: "The Codex desktop pet.",
  displayName: "Codex",
  frame: { columns: 8, height: 208, rows: 9, width: 192 },
  id: "codex",
  source: "builtin",
};

describe("pet catalog query", () => {
  it("后台下载成功后更新目录且不显示操作成功提示", async () => {
    const queryClient = new QueryClient({ mutationCache: createActionMutationCache() });
    const readyPet = { ...downloadablePet, availability: "ready" as const };
    const client = {
      downloadWorkbenchPet: vi.fn().mockResolvedValue({ data: readyPet }),
      listWorkbenchPets: vi.fn(),
    };
    queryClient.setQueryData(petCatalogQueryKey, { data: [downloadablePet] });

    await queryClient
      .getMutationCache()
      .build(queryClient, downloadWorkbenchPetMutationOptions(queryClient, client))
      .execute(downloadablePet.id);

    expect(queryClient.getQueryData(petCatalogQueryKey)).toEqual({ data: [readyPet] });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
