export const generalSettings = {
    trayIcon: "Show status bar icon",
    trayIconDescription: "Show the Codexly icon in the system status bar or tray.",
    trayIconLoadError: "Unable to read status bar icon visibility.",
    autostart: "Launch at login",
    autostartDescription: "Automatically start Codexly when you log in to your computer.",
    autostartLoadError: "Unable to read launch at login status.",
    autostartSaveError: "Unable to change launch at login. Please try again.",
    temporaryFolder: "Non-project task folder",
    temporaryFolderDescription: "New tasks store files and attachments in task ID subfolders. Existing tasks keep their original location.",
    changeFolder: "Change",
    temporaryFolderLoadError: "Unable to load storage location",
    temporaryFolderSaveError: "Unable to save the location. Choose a writable folder and try again.",
    permissions: "Permissions",
    preferences: "Preferences",
    editor: "Editor",
    approvalDescription: "Choose how requests for additional permissions are approved.",
    sandboxDescription: "Limit file access. Full access allows changes outside the workspace.",
    openAppDescription: "The preferred application for opening project files and folders.",
    languageDescription: "The language used in the Codexly interface.",
    themeDescription: "Choose a light or dark appearance, or follow your system.",
    followUpDescription: "Queue new messages while a task runs, or steer the current task immediately.",
    taskNotifications: "Task notifications",
    notificationsDescription: "Send system notifications when a task completes, fails, or needs attention.",
} as const;

export const agentSettings = {
  contextWindow: {
    label: "Context window",
    description: "Enter 272–1000, or leave blank for auto.",
    automatic: "Auto",
    invalid: "Enter a whole number from 272 to 1000, or leave blank.",
  },

  storage: {
    title: "History storage",
    description: "Codex compresses local history files untouched for over 7 days in the background to free disk space.",
    compatibility: "Other Codex clients sharing this history directory must also support compressed history files.",
    action: "Compress history files",
    pending: "Submitting…",
    scheduled: "Background compression requested. This does not confirm completion; there may be no eligible files.",
    failed: "Could not request compression. Check the Codex connection and retry.",
  },

    defaults: "Agent defaults",
    model: "Model defaults",
    webSearch: {
        label: "Web search", description: "Choose how new tasks search the web.",
        disabled: "Disabled", cached: "Cached", live: "Live",
    },
    modelVerbosity: {
        label: "Output verbosity", description: "Choose the level of detail in new task replies. Support varies by model.",
        default: "Model default", low: "Low", medium: "Medium", high: "High",
    },
} as const;
