import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";

/**
 * 应用自有的确认/输入对话框宿主：全应用统一 UI，禁用浏览器原生
 * `window.alert/confirm/prompt`。请求由 `useAppStore.showConfirm/showPrompt` 发起。
 */
export function AppDialog() {
  const dialog = useAppStore((state) => state.dialog);
  const resolveDialog = useAppStore((state) => state.resolveDialog);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!dialog) return;
    setValue(dialog.initialValue);
    setError("");
    if (dialog.kind !== "prompt") return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        resolveDialog(null);
      } else if (event.key === "Enter" && dialog?.kind === "confirm") {
        event.preventDefault();
        resolveDialog(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, resolveDialog]);

  if (!dialog) return null;

  function confirm() {
    if (!dialog) return;
    if (dialog.kind === "prompt") {
      const next = value.trim();
      const message = dialog.validate
        ? dialog.validate(next)
        : next
          ? null
          : "不能为空。";
      if (message) {
        setError(message);
        return;
      }
      resolveDialog(next);
      return;
    }
    resolveDialog(true);
  }

  return (
    <div
      className="app-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) resolveDialog(null);
      }}
    >
      <div
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
      >
        <h2 className="app-dialog-title">{dialog.title}</h2>
        <p className="app-dialog-message">{dialog.message}</p>
        {dialog.kind === "prompt" && (
          <label className="field">
            <span>{dialog.inputLabel}</span>
            <input
              ref={inputRef}
              value={value}
              placeholder={dialog.placeholder}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
          </label>
        )}
        {error && <p className="app-dialog-error">{error}</p>}
        <div className="app-dialog-actions">
          <button className="quiet" onClick={() => resolveDialog(null)}>
            {dialog.cancelLabel}
          </button>
          <button
            className={dialog.danger ? "danger" : ""}
            onClick={confirm}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
