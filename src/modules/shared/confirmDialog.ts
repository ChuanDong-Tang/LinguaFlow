type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
};

const dialogEl = document.querySelector<HTMLDialogElement>("[data-confirm-dialog]");
const titleEl = dialogEl?.querySelector<HTMLElement>("[data-confirm-title]") ?? null;
const copyEl = dialogEl?.querySelector<HTMLElement>("[data-confirm-copy]") ?? null;
const confirmBtnEl = dialogEl?.querySelector<HTMLButtonElement>("[data-confirm-confirm]") ?? null;
const cancelBtnEl = dialogEl?.querySelector<HTMLButtonElement>("[data-confirm-cancel]") ?? null;

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  if (!dialogEl || !titleEl || !copyEl || !confirmBtnEl || !cancelBtnEl) {
    return Promise.resolve(window.confirm(options.message));
  }

  titleEl.textContent = options.title;
  copyEl.textContent = options.message;
  confirmBtnEl.textContent = options.confirmText ?? "Confirm";
  cancelBtnEl.textContent = options.cancelText ?? "Cancel";

  return new Promise((resolve) => {
    const cleanup = (result: boolean): void => {
      confirmBtnEl.removeEventListener("click", onConfirm);
      cancelBtnEl.removeEventListener("click", onCancel);
      dialogEl.removeEventListener("cancel", onCancel);
      if (dialogEl.open) {
        dialogEl.close();
      }
      resolve(result);
    };

    const onConfirm = (): void => cleanup(true);
    const onCancel = (): void => cleanup(false);

    confirmBtnEl.addEventListener("click", onConfirm);
    cancelBtnEl.addEventListener("click", onCancel);
    dialogEl.addEventListener("cancel", onCancel);
    dialogEl.showModal();
  });
}
