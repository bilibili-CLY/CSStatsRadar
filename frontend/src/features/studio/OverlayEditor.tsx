import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Eye, EyeOff, GripVertical, Layers3, Plus, X } from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { RadarCanvas, type RadarCanvasHandle } from "../../components/RadarCanvas";
import { Field, Range, SaveStatus, SizePreset } from "../../components/ui";
import type { AppConfig, OverlayEntry, PlayerMedia, RadarResponse, RatingVersion, ShowcaseLayoutDraft, ShowcaseSlide, StudioKind, StudioSeed } from "../../types";
import { appendOverlayEntry } from "./draftMutations";
import { averageRadar, rating3Available } from "./showcaseMath";
import { useDraft } from "./useDraft";

export function OverlayEditor({
  seed,
  config,
  onNeedMaterial,
  onShowMethodology,
}: {
  seed: StudioSeed | null;
  config: AppConfig;
  onNeedMaterial: () => void;
  onShowMethodology: () => void;
}) {
  const [draft, setDraft, saveState, retrySave, draftReady] = useDraft(
    "overlay",
    {
      entries: [] as OverlayEntry[],
      title: "CS2 玩家叠图雷达",
      subtitle: "队列平均（含隐藏玩家）",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    },
  );
  const canvas = useRef<RadarCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!draftReady || !seed?.radar) return;
    setDraft((current) => {
      const entries = appendOverlayEntry(current.entries, seed.radar!);
      return entries === current.entries ? current : { ...current, entries };
    });
  }, [seed, draftReady]);
  const average = useMemo(() => averageRadar(draft.entries), [draft.entries]);
  const overlays = average
    ? [
        ...draft.entries,
        { id: "average", radar: average, visible: true, color: "#f4f6f8" },
      ]
    : draft.entries;
  async function exportImage() {
    if (!canvas.current) return;
    try {
      setExporting(true);
      await bridge.exportPNG(
        canvas.current.toDataURL(draft.width, draft.height),
        "cs2-overlay-radar.png",
      );
    } finally {
      setExporting(false);
    }
  }
  function moveEntry(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.entries.length) return;
    const entries = [...draft.entries];
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    setDraft({ ...draft, entries });
  }
  return (
    <div className="editor-layout">
      <aside className="card editor-queue">
        <div className="section-heading">
          <div>
            <h2>叠图队列</h2>
            <p>{draft.entries.length} 名玩家</p>
          </div>
          <button
            className="icon-button"
            onClick={onNeedMaterial}
            aria-label="添加玩家"
          >
            <Plus size={17} />
          </button>
        </div>
        {draft.entries.length > 6 && (
          <div className="notice warning compact">
            <AlertTriangle size={16} />
            超过 6 人可能影响可读性
          </div>
        )}
        <div className="layer-list">
          {draft.entries.map((entry, index) => (
            <div
              className="layer-row"
              key={entry.id}
              draggable
              tabIndex={0}
              title="拖动排序；Alt + 方向键也可调整"
              onDragStart={(event) =>
                event.dataTransfer.setData("text/overlay-index", String(index))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveEntry(
                  Number(event.dataTransfer.getData("text/overlay-index")),
                  index,
                );
              }}
              onKeyDown={(event) => {
                if (!event.altKey) return;
                if (event.key === "ArrowUp") moveEntry(index, index - 1);
                if (event.key === "ArrowDown") moveEntry(index, index + 1);
              }}
            >
              <GripVertical size={15} />
              <span className="color-dot" style={{ background: entry.color }} />
              <PlayerAvatarView name={entry.radar.player.name} steamId={entry.radar.player.steam_id}/>
              <strong>{entry.radar.player.name}</strong>
              <button
                className="icon-button"
                aria-label={`${entry.visible ? "隐藏" : "显示"} ${entry.radar.player.name}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    entries: draft.entries.map((item) =>
                      item.id === entry.id
                        ? { ...item, visible: !item.visible }
                        : item,
                    ),
                  })
                }
              >
                {entry.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                className="icon-button"
                aria-label={`移除 ${entry.radar.player.name}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    entries: draft.entries.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <button className="quiet full" onClick={onNeedMaterial}>
          <Plus size={16} />
          从资料库添加
        </button>
      </aside>
      <main className="canvas-stage">
        <div className="stage-toolbar">
          <SaveStatus state={saveState} onRetry={retrySave} />
          <span>平均值始终包含完整队列</span>
        </div>
        <div className="canvas-frame">
          <RadarCanvas
            ref={canvas}
            overlays={overlays}
            title={draft.title}
            subtitle={draft.subtitle}
            previewWidth={draft.width}
            previewHeight={draft.height}
            radarScaleMode={config.showcase.radar_scale_mode}
            radarScale={config.showcase.radar_scale}
            radarAxisScale={config.showcase.radar_axis_scale}
            ratingVersion={config.rating_version}
            showRatingWatermark={config.show_rating_watermark}
            fontScale={draft.fontScale}
          />
        </div>
      </main>
      <aside className="card inspector">
        <div className="inspector-title">
          <Layers3 size={17} />
          <h2>叠图设置</h2>
        </div>
        <Field label="标题">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </Field>
        <Field label="副标题">
          <input
            value={draft.subtitle}
            onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          />
        </Field>
        {draft.entries.map((entry) => (
          <Field key={entry.id} label={entry.radar.player.name}>
            <input
              type="color"
              value={entry.color}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  entries: draft.entries.map((item) =>
                    item.id === entry.id
                      ? { ...item, color: e.target.value }
                      : item,
                  ),
                })
              }
            />
          </Field>
        ))}
        {config.rating_version === "rating_3" && (
          draft.entries.length === 0 || !draft.entries.every((entry) => rating3Available(entry.radar)) ? (
            <div className="notice warning compact">
              <AlertTriangle size={16} />
              队列中的部分比赛缺少源 DEM 或增强事件数据，将以 Rating 2.0 数值渲染。
            </div>
          ) : null
        )}
        <Range
          label="文字大小"
          min={0.7}
          max={1.5}
          step={0.05}
          value={draft.fontScale ?? 1}
          onChange={(fontScale) => setDraft({ ...draft, fontScale })}
        />
        <SizePreset
          value={{ w: draft.width, h: draft.height }}
          onChange={(w, h) => setDraft({ ...draft, width: w, height: h })}
        />
        <button
          className="primary export-action"
          disabled={!draft.entries.length || exporting}
          onClick={exportImage}
        >
          {exporting ? <Spinner /> : <Download size={17} />}
          {exporting ? "正在导出" : "导出叠图 PNG"}
        </button>
      </aside>
    </div>
  );
}
