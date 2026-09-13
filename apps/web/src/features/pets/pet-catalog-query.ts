import type { CodexlyClient } from "@codexly/client";
import type { WorkbenchPetCatalogResponse } from "@codexly/protocol";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { codexlyClient } from "../projects/project-query-contracts.js";

export const petCatalogQueryKey = ["workbench-pets"] as const;

type PetCatalogClient = Pick<CodexlyClient, "downloadWorkbenchPet" | "listWorkbenchPets">;

export function petCatalogQueryOptions(client: PetCatalogClient = codexlyClient) {
  return queryOptions({
    queryFn: ({ signal }) => client.listWorkbenchPets({ signal }),
    queryKey: petCatalogQueryKey,
    staleTime: 30_000,
  });
}

export function downloadWorkbenchPetMutationOptions(
  queryClient: QueryClient,
  client: PetCatalogClient = codexlyClient,
) {
  return mutationOptions({
    // 宠物资源会批量后台下载，完成时仅刷新目录，不打断用户操作。
    meta: { actionNotification: { successMessage: false } },
    mutationFn: async (petId: string) => {
      const idempotencyKey = `workbench-pet-${petId}-${globalThis.crypto.randomUUID()}`;
      return client.downloadWorkbenchPet(petId, { idempotencyKey });
    },
    mutationKey: ["workbench-pets", "download"] as const,
    onSuccess: ({ pets }) => {
      // 后端已重新发现完整目录，前端只替换服务端状态缓存。
      queryClient.setQueryData<WorkbenchPetCatalogResponse>(petCatalogQueryKey, pets);
    },
    scope: { id: "workbench-pet-download" },
  });
}
