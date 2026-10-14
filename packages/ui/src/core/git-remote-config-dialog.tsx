import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "./button.js";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog.js";
import type { GitWorkspaceTranslate } from "./git-commit-editor.js";

/** 配置只在模态表单中编辑；失败保留输入，保存完成后才关闭，避免用户丢失重试上下文。 */
export function GitRemoteConfigDialog({
  initialName,
  initialUrl,
  busy,
  error,
  onSave,
  onClose,
  returnFocusElement,
  t,
}: Readonly<{
  initialName: string;
  initialUrl: string;
  busy: boolean;
  error: string | null;
  onSave: (name: string, url: string) => Promise<boolean>;
  onClose: () => void;
  returnFocusElement?: HTMLElement | null;
  t: GitWorkspaceTranslate;
}>) {
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [returnFocus] = useState(
    () => returnFocusElement ?? (typeof document === "undefined" ? null : document.activeElement),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          // 受控弹窗没有 Radix Trigger，关闭时显式返回原入口，保持键盘操作连续。
          event.preventDefault();
          if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("commit.configureRemote")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void onSave(name.trim(), url.trim()).then((saved) => {
              if (saved) onClose();
            });
          }}
        >
          <label className="block text-label">
            {t("commit.remoteName")}
            <input
              className="mt-1 h-8 w-full rounded-control border border-separator-strong bg-panel px-2 outline-none focus-visible:shadow-focus"
              required
              pattern="[A-Za-z0-9_.-]+"
              maxLength={128}
              value={name}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <label className="block text-label">
            {t("commit.remoteUrl")}
            <input
              className="mt-1 h-8 w-full rounded-control border border-separator-strong bg-panel px-2 outline-none focus-visible:shadow-focus"
              required
              value={url}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://github.com/owner/repo.git"
              onChange={(event) => {
                setUrl(event.currentTarget.value);
              }}
            />
          </label>
          {error ? (
            <p className="break-words text-caption text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" type="button" disabled={busy} onClick={onClose}>
              {t("commit.cancel")}
            </Button>
            <Button
              type="submit"
              className="text-[color:light-dark(#ffffff,#181818)]"
              disabled={busy || !name.trim() || !url.trim()}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
              {t(busy ? "commit.configuringRemote" : "commit.saveRemote")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
