import type { ReactNode } from "react";

import type { NativeWorkbenchClient } from "./project-queries.js";

export type ProjectProviderProps = Readonly<{
  children: ReactNode;
  client?: NativeWorkbenchClient;
}>;
