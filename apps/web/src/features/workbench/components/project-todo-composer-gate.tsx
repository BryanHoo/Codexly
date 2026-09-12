import type { ReactNode } from "react";
import { useTranslation } from "../../../i18n/i18n.js";
import type { useProjectTodoEditing } from "../hooks/use-project-todo-editing.js";

export function ProjectTodoComposerGate({
  active,
  query,
  children,
}: Readonly<{
  active: boolean;
  query: ReturnType<typeof useProjectTodoEditing>["query"];
  children: ReactNode;
}>) {
  const { t } = useTranslation("workbench");
  // 编辑持久化待办前等待正文恢复，避免用空草稿覆盖服务端数据。
  if (!active || query.isSuccess) return children;
  return (
    <div role="status" className="p-4 text-sm text-muted-foreground">
      {query.error?.message ?? t("taskBoard.loading")}
      {query.isError && (
        <button type="button" onClick={() => void query.refetch()}>
          {t("composer.retryTodoLoad")}
        </button>
      )}
    </div>
  );
}
