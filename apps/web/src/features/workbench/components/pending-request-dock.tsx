import { useStore } from "zustand";
import type { TaskStore } from "../../conversation/runtime/task-store.js";
import type { PendingRequestResolveHandler } from "./pending-request-resolution.js";
import { StorePendingRequestList } from "./task-timeline-pending-requests.js";

/** 活动工作台的交互卡片固定在输入框上方，仅订阅请求状态，不跟随消息 Token 更新。 */
export function PendingRequestDock(
  props: Readonly<{
    store: TaskStore | undefined;
    connected: boolean;
    onResolve: PendingRequestResolveHandler;
  }>,
) {
  return props.store === undefined ? null : (
    <PendingRequestDockContent {...props} store={props.store} />
  );
}

function PendingRequestDockContent({
  store,
  connected,
  onResolve,
}: Readonly<{
  store: TaskStore;
  connected: boolean;
  onResolve: PendingRequestResolveHandler;
}>) {
  const visible = useStore(store, (state) =>
    state.pendingRequestIds.some((id) => {
      const request = state.pendingRequestsById[id];
      return request !== undefined && request.status !== "resolved";
    }),
  );
  if (!visible) return null;
  return (
    <div
      data-slot="pending-request-dock"
      className="min-h-0 shrink-0 bg-content px-1 pb-2 max-[360px]:px-0 sm:px-5"
    >
      <div className="mx-auto max-h-[min(44vh,28rem)] w-full max-w-content space-y-2 overflow-y-auto overscroll-contain">
        <StorePendingRequestList
          connected={connected}
          store={store}
          onResolvePendingRequest={onResolve}
        />
      </div>
    </div>
  );
}
