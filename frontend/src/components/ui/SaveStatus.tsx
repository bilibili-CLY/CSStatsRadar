import { Save } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry: () => void;
}) {
  return (
    <span className={`save-state ${state}`} aria-live="polite">
      <Save size={14} />
      {state === "saving"
        ? "保存中"
        : state === "error"
          ? "保存失败"
          : state === "saved"
            ? "已保存"
            : "自动保存"}
      {state === "error" && <button onClick={onRetry}>重试</button>}
    </span>
  );
}