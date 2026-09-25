import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../core/button.js";

type FileTreeContextValue = Readonly<{
  expandedPaths: Set<string>;
  onSelect: ((path: string) => void) | undefined;
  selectedPath: string | undefined;
  togglePath: (path: string) => void;
}>;

const emptyExpandedPaths = new Set<string>();
const FileTreeContext = createContext<FileTreeContextValue>({
  expandedPaths: emptyExpandedPaths,
  onSelect: undefined,
  selectedPath: undefined,
  togglePath: () => undefined,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> &
  Readonly<{
    defaultExpanded?: Set<string>;
    expanded?: Set<string>;
    onExpandedChange?: (expanded: Set<string>) => void;
    onSelect?: (path: string) => void;
    selectedPath?: string;
  }>;

export function FileTree({
  children,
  className = "",
  defaultExpanded = emptyExpandedPaths,
  expanded: controlledExpanded,
  onExpandedChange,
  onSelect,
  selectedPath,
  ...props
}: FileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState(() => new Set(defaultExpanded));
  const expandedPaths = controlledExpanded ?? internalExpanded;
  const togglePath = useCallback(
    (path: string) => {
      const nextExpanded = new Set(expandedPaths);
      if (nextExpanded.has(path)) {
        nextExpanded.delete(path);
      } else {
        nextExpanded.add(path);
      }
      if (controlledExpanded === undefined) {
        setInternalExpanded(nextExpanded);
      }
      onExpandedChange?.(nextExpanded);
    },
    [controlledExpanded, expandedPaths, onExpandedChange],
  );
  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath }),
    [expandedPaths, onSelect, selectedPath, togglePath],
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={`w-full font-mono text-label text-foreground ${className}`}
        data-ai-file-tree=""
        role="tree"
        {...props}
      >
        {children}
      </div>
    </FileTreeContext.Provider>
  );
}

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export function FileTreeIcon({ className = "", ...props }: FileTreeIconProps) {
  return <span className={`shrink-0 ${className}`} {...props} />;
}

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export function FileTreeName({ className = "", ...props }: FileTreeNameProps) {
  return <span className={`min-w-0 flex-1 truncate ${className}`} {...props} />;
}

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    name: string;
    path: string;
    selectionControl?: ReactNode;
    trailing?: ReactNode;
  }>;

export function FileTreeFolder({
  children,
  className = "",
  name,
  path,
  selectionControl,
  trailing,
  ...props
}: FileTreeFolderProps) {
  const { expandedPaths, onSelect, selectedPath, togglePath } = useContext(FileTreeContext);
  const { t } = useTranslation("conversation");
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;
  const selectFolder = () => {
    togglePath(path);
    onSelect?.(path);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if ((event.key === "ArrowRight" && !isExpanded) || (event.key === "ArrowLeft" && isExpanded)) {
      event.preventDefault();
      togglePath(path);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFolder();
    }
  };

  return (
    <div
      aria-expanded={isExpanded}
      aria-selected={isSelected}
      className={className}
      onKeyDown={handleKeyDown}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      <div
        className={`group/file-tree-node flex min-h-7 w-full items-center gap-1 rounded-control px-1.5 text-left transition-colors hover:bg-control-hover ${isSelected ? "bg-control" : ""}`}
      >
        <Button
          aria-label={t(
            isExpanded ? "agentComponents.folderCollapse" : "agentComponents.folderExpand",
            {
              name,
            },
          )}
          className="inline-grid size-5 shrink-0 place-items-center rounded-control text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
          onClick={() => {
            togglePath(path);
          }}
          size="embedded"
          type="button"
          variant="embedded"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        </Button>
        {selectionControl}
        <Button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
          contentAlign="start"
          onClick={selectFolder}
          size="embedded"
          type="button"
          variant="embedded"
        >
          <FileTreeIcon>
            {isExpanded ? (
              <FolderOpen aria-hidden="true" className="size-3.5 text-brand" />
            ) : (
              <Folder aria-hidden="true" className="size-3.5 text-brand" />
            )}
          </FileTreeIcon>
          <FileTreeName title={name}>{name}</FileTreeName>
        </Button>
        {trailing}
      </div>
      {isExpanded ? (
        <div className="ml-3 border-l border-separator pl-1" role="group">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> &
  Readonly<{
    icon?: ReactNode;
    name: string;
    path: string;
    trailing?: ReactNode;
  }>;

export function FileTreeFile({
  children,
  className = "",
  icon,
  name,
  path,
  trailing,
  ...props
}: FileTreeFileProps) {
  const { onSelect, selectedPath } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  const selectFile = () => {
    onSelect?.(path);
  };

  return (
    <div
      aria-selected={isSelected}
      className={`group/file-tree-node flex min-h-7 cursor-pointer items-center gap-1.5 rounded-control px-1.5 transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none ${isSelected ? "bg-control" : ""} ${className}`}
      onClick={selectFile}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectFile();
        }
      }}
      role="treeitem"
      tabIndex={0}
      {...props}
    >
      {children ?? (
        <>
          <span aria-hidden="true" className="size-5 shrink-0" />
          <FileTreeIcon>
            {icon ?? <File aria-hidden="true" className="size-3.5 text-muted-foreground" />}
          </FileTreeIcon>
          <FileTreeName title={path}>{name}</FileTreeName>
        </>
      )}
      {trailing}
    </div>
  );
}

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

export function FileTreeActions({ className = "", ...props }: FileTreeActionsProps) {
  return (
    // 容器只阻止内部按钮事件触发文件行选择，本身不是新的交互控件。
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={`ml-auto flex items-center gap-1 ${className}`}
      onClick={stopPropagation}
      onKeyDown={stopPropagation}
      role="group"
      {...props}
    />
  );
}
