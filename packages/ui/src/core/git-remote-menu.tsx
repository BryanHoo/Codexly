import { useRef } from "react";
import { Ellipsis, Info, RefreshCw, Settings2, Upload } from "lucide-react";
import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";
import type { GitWorkspaceTranslate } from "./git-commit-editor.js";
import type { GitRemoteDialogKind } from "./git-remote-dialog.js";

/** 次要操作收进菜单，操作入口不再依赖展开“检查时间”，表单始终在独立弹窗编辑。 */
export function GitRemoteMenu({
  busy,
  canPublish,
  dialogOpen,
  onInspect,
  onOpen,
  t,
}: Readonly<{
  busy: boolean;
  canPublish: boolean;
  dialogOpen: boolean;
  onInspect: () => void;
  onOpen: (kind: GitRemoteDialogKind, returnFocus: HTMLElement | null) => void;
  t: GitWorkspaceTranslate;
}>) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          size="icon-toolbar"
          variant="ghost"
          type="button"
          data-slot="git-remote-more"
          aria-label={t("commit.moreRemoteActions")}
          title={t("commit.moreRemoteActions")}
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          // 菜单转入弹窗时交给 Dialog 管理焦点，避免菜单关闭后抢回焦点。
          if (dialogOpen) event.preventDefault();
        }}
      >
        <DropdownMenuItem disabled={busy} onSelect={onInspect}>
          <RefreshCw className="size-3.5" />
          {t("commit.inspectRemote")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy}
          onSelect={() => {
            onOpen("configure", trigger.current);
          }}
        >
          <Settings2 className="size-3.5" />
          {t("commit.configureRemote")}
        </DropdownMenuItem>
        {canPublish ? (
          <DropdownMenuItem
            disabled={busy}
            onSelect={() => {
              onOpen("publish", trigger.current);
            }}
          >
            <Upload className="size-3.5" />
            {t("commit.publishBranch")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            onOpen("info", trigger.current);
          }}
        >
          <Info className="size-3.5" />
          {t("commit.remoteInfo")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
