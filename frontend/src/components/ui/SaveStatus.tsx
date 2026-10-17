import { AlertCircle, Check, Save } from "lucide-react";
import { Spinner } from "../Busy";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  return (
    <span className={`save-state ${state}`} role="status" aria-live="polite">
      {state === "saving" ? (
        <Spinner size={13} />
      ) : state === "saved" ? (
        <Check size={14} />
      ) : state === "error" ? (
        <AlertCircle size={14} />
      ) : (
        <Save size={14} />
      )}
      <span>
        {state === "saving"
          ? "保存中"
          : state === "error"
            ? "保存失败"
            : state === "saved"
              ? "已保存"
              : "自动保存"}
      </span>
      {state === "error" && <button onClick={onRetry}>重试</button>}
    </span>
  );
}