import { useState } from "react";
import type { PendingPrompt } from "./pending-prompt.js";

export function useNewChatPendingPrompt(scope: string, beginSubmission: () => void) {
  const [state, setState] = useState<{ prompt: PendingPrompt | undefined; scope: string }>();
  return {
    pendingPrompt: state?.scope === scope ? state.prompt : undefined,
    onDirectSubmission: (prompt?: PendingPrompt) => {
      beginSubmission();
      setState({ prompt, scope });
    },
    onSubmissionFailed: () => {
      setState(undefined);
    },
  } as const;
}
