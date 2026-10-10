import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchVisibility } from "./use-search-visibility.js";

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ cancelQueries: vi.fn() }) }));

describe("搜索关闭后的分屏焦点", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["false", "true"])("原输入框所在窗口 active=%s 时恢复正确焦点", (active) => {
    const focusPrevious = vi.fn();
    const focusActive = vi.fn();
    class PreviousElement {
      isConnected = true;
      focus = focusPrevious;
      closest() {
        return { getAttribute: () => active };
      }
    }
    vi.stubGlobal("HTMLElement", PreviousElement);
    vi.stubGlobal("document", {
      activeElement: new PreviousElement(),
      querySelector: () => ({ focus: focusActive }),
    });
    let visibility: ReturnType<typeof useSearchVisibility> | undefined;
    function Probe() {
      visibility = useSearchVisibility(
        true,
        { current: null },
        { current: null },
        { current: null },
      );
      return null;
    }
    renderToStaticMarkup(<Probe />);
    if (visibility === undefined) throw new Error("搜索焦点测试未挂载");
    visibility.onOpenAutoFocus(new Event("open", { cancelable: true }));
    visibility.onCloseAutoFocus(new Event("close", { cancelable: true }));
    if (active === "false") {
      expect(focusPrevious).not.toHaveBeenCalled();
      expect(focusActive).toHaveBeenCalledWith({ preventScroll: true });
    } else {
      expect(focusPrevious).toHaveBeenCalledOnce();
      expect(focusActive).not.toHaveBeenCalled();
    }
  });
});
