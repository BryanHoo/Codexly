import { beforeEach, expect, test, vi } from "vitest";
import { useActionErrorToast } from "./use-action-error-toast.js";
import { notifyActionError } from "./action-notifications.js";

const reference = vi.hoisted(() => ({ current: false }));
vi.mock("react", () => ({
  useRef: () => reference,
  useEffect: (effect: () => void) => {
    effect();
  },
}));
vi.mock("./action-notifications.js", () => ({ notifyActionError: vi.fn() }));

beforeEach(() => {
  reference.current = false;
  vi.mocked(notifyActionError).mockClear();
});

test("repeated polling errors show one toast until the query recovers", () => {
  useActionErrorToast(new Error("first"), "问题状态同步失败");
  useActionErrorToast(new Error("second"), "问题状态同步失败");
  expect(notifyActionError).toHaveBeenCalledExactlyOnceWith("问题状态同步失败");

  useActionErrorToast(null, "问题状态同步失败");
  useActionErrorToast(new Error("third"), "问题状态同步失败");
  expect(notifyActionError).toHaveBeenCalledTimes(2);
});
