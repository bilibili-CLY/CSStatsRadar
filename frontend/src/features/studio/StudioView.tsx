import { useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useStudioStore } from "../../stores/studioStore";
import type { StudioKind } from "../../types";
import { OverlayEditor } from "./OverlayEditor";
import { RadarEditor } from "./RadarEditor";
import { ShowcaseEditor } from "./ShowcaseEditor";

const studioKinds: StudioKind[] = ["radar", "overlay", "showcase"];

export function StudioView() {
  const { kind: kindParam } = useParams();
  const kind: StudioKind = (studioKinds as string[]).includes(kindParam ?? "")
    ? (kindParam as StudioKind)
    : "radar";
  const seed = useStudioStore((state) => state.seed);
  const config = useAppStore((state) => state.config);
  const setMethodologyOpen = useAppStore((state) => state.setMethodologyOpen);
  const navigate = useNavigate();
  const onNeedMaterial = () => navigate("/library");
  const onShowMethodology = () => setMethodologyOpen(true);
  return (
    <div className="page studio-page">
      <header className="page-header compact-header">
        <div>
          <span className="eyebrow">制作工作区</span>
          <h1>制作</h1>
        </div>
        <div className="studio-tabs">
          <button
            className={kind === "radar" ? "active" : ""}
            onClick={() => navigate("/studio/radar")}
          >
            雷达图
          </button>
          <button
            className={kind === "overlay" ? "active" : ""}
            onClick={() => navigate("/studio/overlay")}
          >
            叠图对比
          </button>
          <button
            className={kind === "showcase" ? "active" : ""}
            onClick={() => navigate("/studio/showcase")}
          >
            展示轮播
          </button>
        </div>
      </header>
      {kind === "radar" && (
        <RadarEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}{" "}
      {kind === "overlay" && (
        <OverlayEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}{" "}
      {kind === "showcase" && (
        <ShowcaseEditor
          seed={seed}
          config={config}
          onNeedMaterial={onNeedMaterial}
          onShowMethodology={onShowMethodology}
        />
      )}
    </div>
  );
}
