import { ChevronDown, BookmarkPlus, FilePlus2 } from "lucide-react";
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from "react";
import { Button } from "./button.js";
import type { PromptProject } from "./saved-prompt-editor.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

const SavedPromptEditor = lazy(() => import("./saved-prompt-editor.js"));

/** 宿主提供已加载的完整项目列表，所有输入框复用，不为弹窗重复请求。 */
export const ComposerPromptProjectsContext = createContext<readonly PromptProject[] | undefined>(
  undefined,
);

/** 紧凑发送区继承整组配色，使用共享的小圆角与较少的横向留白。 */
export const composerSubmitButtonClassName =
  "flex h-full w-auto shrink-0 items-center justify-center gap-0 rounded-l-control rounded-r-none bg-transparent pl-2.5 pr-2 text-label font-medium leading-4 text-inherit shadow-none hover:bg-transparent hover:text-inherit hover:shadow-none active:brightness-100 disabled:bg-transparent disabled:text-inherit [&>span]:items-center [&>span]:justify-center [&>span]:leading-4 [&>span]:animate-none";

/** 两端共享分体按钮；菜单动作不改变发送模式，也不会提交外层输入表单。 */
export function ComposerSubmitActions({
  children,
  language,
  content,
  hasInput = Boolean(content.trim()),
  project,
  disabled,
  todoDisabled,
  todoLabel,
  onSaveTodo,
}: Readonly<{
  children: ReactNode;
  language: string;
  content: string;
  hasInput?: boolean;
  project?: PromptProject | undefined;
  disabled: boolean;
  todoDisabled: boolean;
  todoLabel: string;
  onSaveTodo?: (() => void) | undefined;
}>) {
  const zh = language.startsWith("zh");
  const projects = useContext(ComposerPromptProjectsContext);
  const [prompt, setPrompt] = useState<{ content: string; project: PromptProject | undefined }>();
  // 范围固定在点击时的项目；同一项目的名称加载或重命名后，及时更新显示文本。
  const promptProject = prompt?.project
    ? (projects?.find((item) => item.id === prompt.project?.id) ??
      (project?.id === prompt.project.id ? project : prompt.project))
    : undefined;
  return (
    <>
      <div
        className="flex h-6 shrink-0 items-center rounded-control border border-separator bg-control-hover/40 text-muted-foreground transition-colors duration-150 hover:bg-control-hover motion-reduce:transition-none data-[has-input=true]:border-transparent data-[has-input=true]:bg-foreground/85 data-[has-input=true]:text-raised data-[has-input=true]:hover:bg-foreground/75"
        data-has-input={hasInput && !disabled}
        role="group"
        aria-label={zh ? "发送操作" : "Send actions"}
      >
        {/* 有输入时以柔和的反色主色强调；悬停任意半区统一减淡底色，文字与箭头保持一致的对比度。 */}
        {children}
        <span aria-hidden="true" className="h-2.5 w-px bg-current opacity-20" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={zh ? "更多发送操作" : "More send actions"}
              className="flex h-full w-4.5 items-center justify-center rounded-l-none rounded-r-control px-0 text-inherit shadow-none hover:bg-transparent hover:text-inherit hover:shadow-none active:brightness-100 data-[state=open]:bg-current/10 data-[state=open]:text-inherit"
            >
              <ChevronDown aria-hidden="true" className="size-2.5" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={6}>
            {onSaveTodo ? (
              <DropdownMenuItem disabled={todoDisabled} onSelect={onSaveTodo}>
                <FilePlus2 aria-hidden="true" className="size-3.5" />
                {todoLabel}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={!content.trim()}
              onSelect={() => {
                // 保存点击瞬间的原始正文，保留换行与空白；附件仍留在聊天草稿中。
                // 与正文一起固定点击时的项目，避免弹窗期间切换会话导致范围错绑。
                setPrompt({ content, project });
              }}
            >
              <BookmarkPlus aria-hidden="true" className="size-3.5" />
              {zh ? "保存为常用提示词" : "Save as prompt"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {prompt !== undefined ? (
        <Suspense fallback={null}>
          <SavedPromptEditor
            language={language}
            initialDraft={{
              name: "",
              content: prompt.content,
              ...(prompt.project ? { projectId: prompt.project.id } : {}),
            }}
            projects={projects ?? (promptProject ? [promptProject] : undefined)}
            onClose={() => {
              setPrompt(undefined);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
