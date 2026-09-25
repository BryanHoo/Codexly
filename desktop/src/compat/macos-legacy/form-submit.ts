export function installLegacyFormSubmit(): void {
  if (typeof HTMLFormElement.prototype.requestSubmit === "function") return;
  Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", {
    configurable: true,
    writable: true,
    value(this: HTMLFormElement, submitter?: HTMLElement | null) {
      if (submitter != null) {
        const isSubmitButton = submitter instanceof HTMLButtonElement && submitter.type === "submit";
        const isSubmitInput = submitter instanceof HTMLInputElement && ["submit", "image"].includes(submitter.type);
        if (!isSubmitButton && !isSubmitInput) throw new TypeError("The submitter is not a submit button");
        if ((submitter as HTMLButtonElement | HTMLInputElement).form !== this) {
          throw new DOMException("The submitter does not belong to this form", "NotFoundError");
        }
        submitter.click();
        return;
      }
      // Safari 15.5 缺少 requestSubmit；原生按钮激活保留表单校验和 React submit 事件。
      // 临时按钮不占布局、不抢焦点，提交完成后立即移除，避免影响后续 FormData。
      const button = document.createElement("button");
      button.type = "submit";
      button.hidden = true;
      this.append(button);
      try {
        button.click();
      } finally {
        button.remove();
      }
    },
  });
}
