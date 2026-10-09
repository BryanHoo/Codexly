export const common = {
  imagePreview: {
    actualSize: "Original size",
    fit: "Fit to container",
    loadError: "Unable to preview image",
    loading: "Loading image",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
  },
  access: {
    checking: "Checking access",
    codeLabel: "Access password",
    loadError: "Unable to check access",
    pair: "Pair",
    pairing: "Pairing",
    pairingDescription: "Enter the access password configured or shown when Codexly started.",
    pairingError: "Unable to pair. Check the access password and try again",
    pairingTitle: "Connect to a trusted LAN session",
  },
  actions: {
    backToWorkbench: "Back to workbench",
    retry: "Retry",
  },
  app: {
    actionFailed: "Action failed",
    actionSucceeded: "Action completed",
    loadingProjects: "Loading projects",
    noProjects: "No projects added",
    notificationRegion: "Notifications",
  },
  errors: {
    taskDeletionBlockedByForks:
      "This task can’t be deleted because forked tasks still use its history. You can archive it, or delete the related forked tasks first and try again.",
    notFoundDescription: "This address does not match a registered application route.",
    notFoundTitle: "Page not found",
    routeErrorLabel: "Route error",
    routeErrorTitle: "Failed to load page",
    runtimeUnavailableDescription:
      "First run <command>codex login</command> in the official Codex CLI, then retry after signing in.",
    runtimeUnavailableTitle: "Codex Runtime unavailable",
  },
  language: {
    english: "English",
    simplifiedChinese: "Simplified Chinese",
  },
} as const;
