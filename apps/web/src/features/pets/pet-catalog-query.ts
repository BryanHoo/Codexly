import type { CodexlyClient } from "@codexly/client";
import type { WorkbenchPetCatalogResponse, WorkbenchPetDescriptor } from "@codexly/protocol";
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

export function mergeDownloadedPet(
  catalog: WorkbenchPetCatalogResponse | undefined,
  downloaded: WorkbenchPetDescriptor,
): WorkbenchPetCatalogResponse {
  const pets = catalog?.data ?? [];
  const index = pets.findIndex((pet) => pet.id === downloaded.id);
  if (index < 0) return { data: [...pets, downloaded] };
  return { data: pets.map((pet, petIndex) => (petIndex === index ? downloaded : pet)) };
}

export function downloadWorkbenchPetMutationOptions(
  queryClient: QueryClient,
  client: PetCatalogClient = codexlyClient,
) {
  return mutationOptions({
    mutationFn: async (petId: string) => {
      const idempotencyKey = `workbench-pet-${petId}-${globalThis.crypto.randomUUID()}`;
      return client.downloadWorkbenchPet(petId, { idempotencyKey });
    },
    mutationKey: ["workbench-pets", "download"] as const,
    onSuccess: ({ data }) => {
      // 下载完成后直接升级目标项，避免整份目录闪回 loading 状态。
      queryClient.setQueryData<WorkbenchPetCatalogResponse>(petCatalogQueryKey, (catalog) =>
        mergeDownloadedPet(catalog, data),
      );
    },
    scope: { id: "workbench-pet-download" },
  });
}
