import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { i18n, I18nextProvider } from "../i18n/i18n.js";
import { TooltipProvider } from "../shared/components/core/tooltip.js";
import { router } from "./router.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export function ProjectFileWindowApplication() {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </TooltipProvider>
    </I18nextProvider>
  );
}
