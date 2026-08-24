import { MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";

import { i18n } from "../../i18n/i18n.js";

export const ACTION_NOTIFICATION_META_KEY = "actionNotification";

type ActionNotificationOptions = Readonly<{
  error?: boolean;
  successMessage?: false | string;
}>;

function readNotificationOptions(
  mutation: Readonly<{ meta: Readonly<Record<string, unknown>> | undefined }>,
): ActionNotificationOptions | false | undefined {
  const value = mutation.meta?.[ACTION_NOTIFICATION_META_KEY];
  if (value === false) return false;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const error = "error" in value && typeof value.error === "boolean" ? value.error : undefined;
  const successMessage =
    "successMessage" in value &&
    (typeof value.successMessage === "string" || value.successMessage === false)
      ? value.successMessage
      : undefined;
  return {
    ...(error === undefined ? {} : { error }),
    ...(successMessage === undefined ? {} : { successMessage }),
  };
}

export function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return i18n.t("app.actionFailed", { ns: "common" });
}

export function notifyActionError(error: unknown): void {
  toast.error(actionErrorMessage(error));
}

export function notifyActionSuccess(
  message = i18n.t("app.actionSucceeded", { ns: "common" }),
): void {
  toast.success(message);
}

export function createActionMutationCache(): MutationCache {
  return new MutationCache({
    onError(error, _variables, _context, mutation) {
      const options = readNotificationOptions(mutation);
      if (options !== false && options?.error !== false) notifyActionError(error);
    },
    onSuccess(_data, _variables, _context, mutation) {
      const options = readNotificationOptions(mutation);
      if (options === false || options?.successMessage === false) return;
      notifyActionSuccess(options?.successMessage);
    },
  });
}
