import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { FileArchive } from "lucide-react";
import { bridge } from "../../bridge";
import { formatDemoDate } from "../../lib/format";
import type { DemoRecord } from "../../types";

interface Props {
  demo: DemoRecord;
  variant?: "catalog" | "analysis";
  selected?: boolean;
  onSelected?: (checked: boolean) => void;
  editableNote?: boolean;
  onSavedNote?: () => Promise<void> | void;
  onOpen?: () => void;
  footer?: ReactNode;
}

export function DemoCard({
  demo,
  variant = "catalog",
  selected = false,
  onSelected,
  editableNote = false,
  onSavedNote,
  onOpen,
  footer,
}: Props) {
  const [note, setNote] = useState(demo.note ?? "");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  useEffect(() => setNote(demo.note ?? ""), [demo.note]);

  async function save() {
    if (note.trim() === (demo.note ?? "").trim()) return;
    try {
      setSaveState("saving");
      await bridge.updateDemoNote(demo.demo_record_id, note);
      setSaveState("saved");
      await onSavedNote?.();
    } catch {
      setSaveState("error");
    }
  }

  const activate = () => {
    if (variant === "catalog") onSelected?.(!selected);
    else onOpen?.();
  };
  function toggleFromKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target === event.currentTarget
    ) {
      event.preventDefault();
      activate();
    }
  }

  return (
    <article
      className={`persistent-demo-card ${variant === "analysis" ? "analysis-demo-card" : ""} ${selected ? "selected" : ""}`}
      role={variant === "catalog" ? "checkbox" : "button"}
      aria-checked={variant === "catalog" ? selected : undefined}
      tabIndex={0}
      onKeyDown={toggleFromKeyboard}
      onClick={activate}
    >
      <header>
        {variant === "catalog" && (
          <label
            className="demo-select"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelected?.(event.target.checked)}
            />
            <span className="sr-only">选择 {demo.file_name}</span>
          </label>
        )}
        <button className="persistent-demo-summary" tabIndex={-1}>
          <span className="demo-file-icon">
            <FileArchive size={18} />
          </span>
          <span>
            <strong title={demo.file_name}>{demo.map_name || "未知地图"}</strong>
            <small title={demo.file_name}>{demo.file_name}</small>
          </span>
          <b>
            {demo.score_a}
            <i>:</i>
            {demo.score_b}
          </b>
        </button>
      </header>
      <button className="persistent-demo-meta" tabIndex={-1}>
        <span>{demo.rounds || "—"} 回合</span>
        <span>{demo.participants?.length ?? 0} 名玩家</span>
        <span title={demo.match_time_source}>
          {formatDemoDate(demo.match_time)}
        </span>
      </button>
      {variant === "catalog" && editableNote && (
        <label
          className="demo-note-field"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="sr-only">比赛备注</span>
          <input
            value={note}
            maxLength={500}
            placeholder="点击添加备注…"
            onChange={(event) => {
              setNote(event.target.value);
              setSaveState("idle");
            }}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                event.currentTarget.blur();
            }}
          />
          <small aria-live="polite">
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存"
                : saveState === "error"
                  ? "保存失败"
                  : `${note.length}/500`}
          </small>
        </label>
      )}
      {footer && (
        <footer onClick={(event) => event.stopPropagation()}>{footer}</footer>
      )}
    </article>
  );
}