export const generalSettings = {
  permissions: "Permissions",
  preferences: "Preferences",
  editor: "Editor",
  approvalDescription: "Choose how requests for additional permissions are approved.",
  sandboxDescription: "Limit file access. Full access allows changes outside the workspace.",
  openAppDescription: "The preferred application for opening project files and folders.",
  languageDescription: "The language used in the Codexly interface.",
  themeDescription: "Choose a light or dark appearance, or follow your system.",
  followUpDescription:
    "Queue new messages while a task runs, or steer the current task immediately.",
  taskNotifications: "Task notifications",
  notificationsDescription:
    "Send system notifications when a task completes, fails, or needs attention.",
} as const;

export const agentSettings = {
  defaults: "Agent defaults",
  model: "Model defaults",
  webSearch: {
    label: "Web search",
    description: "Choose how new tasks search the web.",
    disabled: "Disabled",
    cached: "Cached",
    live: "Live",
  },
  modelVerbosity: {
    label: "Output verbosity",
    description: "Choose the level of detail in new task replies. Support varies by model.",
    default: "Model default",
    low: "Low",
    medium: "Medium",
    high: "High",
  },
} as const;
