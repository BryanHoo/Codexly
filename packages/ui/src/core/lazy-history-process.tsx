import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";

/** 过程代码在首次展开时才下载；收起后保留组件，复用已读取的历史页和分页状态。 */
export function createLazyHistoryProcess<Props extends { expanded: boolean }>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  const Process = lazy(load);
  return function LazyHistoryProcess(props: Props) {
    const [opened, setOpened] = useState(props.expanded);
    useEffect(() => {
      if (props.expanded) setOpened(true);
    }, [props.expanded]);
    if (!opened && !props.expanded) return null;
    return (
      <Suspense fallback={null}>
        <Process {...props} />
      </Suspense>
    );
  };
}
