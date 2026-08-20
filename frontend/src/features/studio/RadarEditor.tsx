import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Plus, SlidersHorizontal } from "lucide-react";
import { bridge } from "../../bridge";
import { Spinner } from "../../components/Busy";
import { PlayerAvatarView } from "../../components/PlayerAvatar";
import { RadarCanvas, type RadarCanvasHandle } from "../../components/RadarCanvas";
import { Field, Range, SaveStatus, SizePreset } from "../../components/ui";
import type { AppConfig, RadarResponse, StudioSeed } from "../../types";
import { rating3Available } from "./showcaseMath";
import { useDraft } from "./useDraft";

export function RadarEditor({
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
    "radar",
    {
      radar: null as RadarResponse | null,
      title: "",
      subtitle: "",
      color: "#22d3ee",
      width: config.export_width,
      height: config.export_height,
      fontScale: 1,
    },
  );
  const canvas = useRef<RadarCanvasHandle>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (draftReady && seed?.radar)
      setDraft((current) => ({
        ...current,
        radar: seed.radar!,
        title: seed.player.name,
        subtitle: `已选 ${seed.matchIds.length} 场比赛`,
      }));
  }, [seed, draftReady]);
  async function exportImage() {
    if (!canvas.current || !draft.radar) return;
    try {
      setExporting(true);
      await bridge.exportPNG(
        canvas.current.toDataURL(draft.width, draft.height),
        `${draft.title || draft.radar.player.name}-radar.png`,
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="editor-layout">
      <aside className="card editor-queue">
        <div className="section-heading">
          <div>
            <h2>当前素材</h2>
            <p>单场与综合雷达共用编辑器</p>
          </div>
        </div>
        {draft.radar ? (
          <div className="material-card">
            <PlayerAvatarView name={draft.radar.player.name} steamId={draft.radar.player.steam_id}/>
            <div>
              <strong>{draft.radar.player.name}</strong>
              <p>{draft.radar.match_count} 场比赛</p>
            </div>
          </div>
        ) : (
          <button className="empty-action" onClick={onNeedMaterial}>
            <Plus />
            从资料库选择
          </button>
        )}
      </aside>
      <main className="canvas-stage">
        <div className="stage-toolbar">
          <SaveStatus state={saveState} onRetry={retrySave} />
          <span>
            {draft.width} × {draft.height}
          </span>
        </div>
        <div className="canvas-frame">
          <RadarCanvas
            ref={canvas}
            radar={draft.radar}
            color={draft.color}
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
          <SlidersHorizontal size={17} />
          <h2>雷达设置</h2>
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
        <Field label="雷达颜色">
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          />
        </Field>
        {config.rating_version === "rating_3" && !(draft.radar && rating3Available(draft.radar)) && (
          <div className="notice warning compact">
            <AlertTriangle size={16} />
            {draft.radar?.rating_3_status?.reason ?? "此素材缺少 Rating 3.0 增强事件数据，将以 Rating 2.0 数值渲染。"}
          </div>
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
          disabled={!draft.radar || exporting}
          onClick={exportImage}
        >
          {exporting ? <Spinner /> : <Download size={17} />}
          {exporting ? "正在导出" : "导出 PNG"}
        </button>
      </aside>
    </div>
  );
}
