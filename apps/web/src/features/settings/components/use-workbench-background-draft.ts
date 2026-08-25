import { useEffect, useState } from "react";

import {
  DEFAULT_WORKBENCH_BACKGROUND,
  readCustomBackgroundImage,
  readWorkbenchBackgroundPreference,
  type WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

function readInitialBackground(): WorkbenchBackgroundPreference {
  return typeof window === "undefined"
    ? DEFAULT_WORKBENCH_BACKGROUND
    : readWorkbenchBackgroundPreference(window.localStorage);
}

export function useWorkbenchBackgroundDraft() {
  const [background, setBackground] =
    useState<WorkbenchBackgroundPreference>(readInitialBackground);
  const [customBackgroundFile, setCustomBackgroundFileState] = useState<File | null>(null);
  const [hasStoredCustomBackground, setHasStoredCustomBackground] = useState(false);

  useEffect(() => {
    let disposed = false;
    void readCustomBackgroundImage()
      .then((image) => {
        if (!disposed) setHasStoredCustomBackground(image !== null);
      })
      .catch(() => {
        if (!disposed) setHasStoredCustomBackground(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  return {
    background,
    customBackgroundFile,
    customBackgroundMissing:
      background.mode === "custom" && customBackgroundFile === null && !hasStoredCustomBackground,
    setBackground,
    setCustomBackgroundFile: (file: File) => {
      setCustomBackgroundFileState(file);
      setHasStoredCustomBackground(true);
    },
  } as const;
}
