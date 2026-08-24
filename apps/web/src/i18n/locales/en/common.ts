export const common = {
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
