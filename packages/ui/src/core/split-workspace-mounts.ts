import { splitPaneKey, type SplitPaneIdentity } from "@codexly/frontend-core/split-workspace";

type Mounts = Readonly<{
  panes: readonly SplitPaneIdentity[];
  keys: number[];
  nextKey: number;
}>;

/** 先按任务身份复用，再让同项目替换继承被移除窗口的实例；每个实例只复用一次。 */
export function remapSplitPaneMounts(
  previous: Mounts,
  panes: readonly SplitPaneIdentity[],
): Mounts {
  let nextKey = previous.nextKey;
  const reused = new Set<number>();
  const keys = panes.map((pane) => {
    let index = previous.panes.findIndex((item) => splitPaneKey(item) === splitPaneKey(pane));
    if (index === -1)
      index = previous.panes.findIndex(
        (item, candidate) =>
          !reused.has(candidate) &&
          item.projectId === pane.projectId &&
          !panes.some((next) => splitPaneKey(next) === splitPaneKey(item)),
      );
    if (index !== -1) reused.add(index);
    return (
      (previous.panes.length === 1 && panes.length === 1
        ? previous.keys[0]
        : previous.keys[index]) ?? nextKey++
    );
  });
  return { panes, keys, nextKey };
}
