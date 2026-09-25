import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, FileMinus2, FilePenLine, FilePlus2, Folder } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import { cn } from "../../../shared/lib/utils.js";
import type { FileNavigationViewMode } from "../../diff/file-navigation-view-preference.js";
import { buildCommitChangeTree, type CommitChange, type CommitChangeTreeNode } from "./commit-change-tree-model.js";

type Row = Readonly<{ key: string; label: string; depth: number }> & (
  | Readonly<{ kind: "section"; paths: readonly string[] }>
  | Readonly<{ kind: "folder"; path: string; name: string }>
  | Readonly<{ kind: "file"; change: CommitChange; name: string }>
);
const EMPTY: readonly CommitChange[] = [];

function appendRows(rows: Row[], nodes: readonly CommitChangeTreeNode[], changes: ReadonlyMap<string, CommitChange>, label: string, collapsed: ReadonlySet<string>, depth = 0) {
  for (const node of nodes) {
    const key = `${label}:${node.path}`;
    if (node.kind === "folder") {
      rows.push({ key, label, depth, kind: "folder", path: node.path, name: node.name });
      if (!collapsed.has(key)) appendRows(rows, node.children, changes, label, collapsed, depth + 1);
    } else {
      const change = changes.get(node.path);
      if (change) rows.push({ key, label, depth, kind: "file", name: node.name, change });
    }
  }
}

export function CommitChangesTreeSection({ changes, disabled = false, label, onOpenFileDiff, onSelectedPathsChange, selectedPaths, viewMode = "tree", secondaryChanges = EMPTY, secondaryLabel = "", statsAvailable = false }: Readonly<{
  changes: readonly CommitChange[];
  disabled?: boolean;
  label: string;
  onOpenFileDiff: (change: CommitChange) => void;
  onSelectedPathsChange: (paths: Set<string>) => void;
  selectedPaths: ReadonlySet<string>;
  viewMode?: FileNavigationViewMode;
  secondaryChanges?: readonly CommitChange[];
  secondaryLabel?: string;
  statsAvailable?: boolean;
}>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<number | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const sections = useMemo(() => [
    { changes, label }, { changes: secondaryChanges, label: secondaryLabel },
  ].filter((section) => section.changes.length > 0).map((section) => ({
    ...section,
    paths: section.changes.map((change) => change.path),
    byPath: new Map(section.changes.map((change) => [change.path, change])),
    nodes: viewMode === "tree" ? buildCommitChangeTree(section.changes) : [],
    sorted: viewMode === "list" ? section.changes.toSorted((a, b) => a.path.localeCompare(b.path, "en")) : [],
  })), [changes, label, secondaryChanges, secondaryLabel, viewMode]);
  const rows = useMemo(() => {
    const result: Row[] = [];
    for (const section of sections) {
      result.push({ key: section.label, label: section.label, depth: 0, kind: "section", paths: section.paths });
      if (viewMode === "tree") appendRows(result, section.nodes, section.byPath, section.label, collapsed);
      else for (const change of section.sorted) result.push({ key: `${section.label}:${change.path}`, kind: "file", label: section.label, depth: 0, name: change.path, change });
    }
    return result;
  }, [sections, collapsed, viewMode]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.key ?? index,
    estimateSize: () => 28,
    overscan: 8,
    initialRect: { width: 400, height: 400 },
  });
  const visible = virtualizer.getVirtualItems();
  useLayoutEffect(() => {
    if (focusRequest.current === null) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${focusRequest.current}"]`);
    if (row) { row.focus(); focusRequest.current = null; }
  }, [visible]);
  const toggle = (path: string) => {
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path); else next.add(path);
    onSelectedPathsChange(next);
  };
  const toggleFolder = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const navigate = (event: KeyboardEvent, index: number) => {
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    focusRequest.current = Math.max(0, Math.min(rows.length - 1, next));
    virtualizer.scrollToIndex(focusRequest.current, { align: "auto" });
    scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${focusRequest.current}"]`)?.focus();
  };
  return <div ref={scrollRef} className="h-full min-h-0 flex-1 overflow-y-auto overscroll-contain" data-slot="commit-changes-scroll">
    {/* 两个分组共享一个虚拟窗口，DOM 数量只随视口高度变化。 */}
    <div role="tree" aria-label={label} data-slot={viewMode === "list" ? "commit-changes-list" : "commit-changes-tree"} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {visible.map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        const style = { height: 28, left: 0, top: 0, width: "100%", position: "absolute" as const, transform: `translateY(${item.start}px)`, paddingLeft: 12 + row.depth * 14 };
        if (row.kind === "section") {
          const count = row.paths.reduce((sum, path) => sum + Number(selectedPaths.has(path)), 0);
          return <div role="treeitem" key={row.key} style={style} className="flex items-center gap-1.5 pr-3" data-row-index={item.index} tabIndex={-1} onKeyDown={(event) => navigate(event, item.index)}>
            <Checkbox aria-label={row.label} checked={count === 0 ? false : count === row.paths.length ? true : "indeterminate"} disabled={disabled} onCheckedChange={(checked) => {
              const next = new Set(selectedPaths);
              for (const path of row.paths) { if (checked) next.add(path); else next.delete(path); }
              onSelectedPathsChange(next);
            }} />
            <h3 className="text-label font-semibold">{row.label}</h3><span className="ml-auto text-caption text-muted-foreground">{row.paths.length}</span>
          </div>;
        }
        const folder = row.kind === "folder";
        const expanded = folder && !collapsed.has(row.key);
        const path = folder ? row.path : row.change.path;
        const kind = folder ? "update" : row.change.kind;
        const Icon = folder ? Folder : kind === "create" ? FilePlus2 : kind === "delete" ? FileMinus2 : FilePenLine;
        const open = () => { if (folder) toggleFolder(row.key); else onOpenFileDiff(row.change); };
        return <div key={row.key} role="treeitem" aria-label={path} aria-level={viewMode === "tree" ? row.depth + 1 : undefined} aria-expanded={folder ? expanded : undefined} tabIndex={0} data-row-index={item.index} style={style} className="flex cursor-pointer items-center gap-1.5 pr-3 font-mono text-label hover:bg-control-hover focus-visible:shadow-focus" onClick={open} onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          navigate(event, item.index);
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
          if (folder && ((event.key === "ArrowLeft" && expanded) || (event.key === "ArrowRight" && !expanded))) { event.preventDefault(); toggleFolder(row.key); }
        }}>
          {folder ? <ChevronRight aria-hidden="true" className={cn("size-3.5 shrink-0", expanded && "rotate-90")} /> : <Checkbox aria-label={`${row.label}: ${path}`} checked={selectedPaths.has(path)} disabled={disabled} onClick={(event) => event.stopPropagation()} onCheckedChange={() => toggle(path)} />}
          <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", !folder && (kind === "create" ? "text-diff-added" : kind === "delete" ? "text-danger" : "text-warning"))} />
          <span className="min-w-0 flex-1 truncate" title={path}>{row.name}</span>
          {!folder && (statsAvailable || row.change.diff !== "") && <span className="flex shrink-0 gap-1 text-meta" aria-label={`+${row.change.stats.additions} -${row.change.stats.removals}`}>
            <span className="text-diff-added">+{row.change.stats.additions}</span>
            <span className="text-diff-removed">-{row.change.stats.removals}</span>
          </span>}
          {!folder && <span className="text-meta text-muted-foreground">{kind === "create" ? "A" : kind === "delete" ? "D" : "M"}</span>}
        </div>;
      })}
    </div>
  </div>;
}
