import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Database,
  ChartNoAxesCombined,
  FolderInput,
  Library,
  Settings,
  Sparkles,
} from "lucide-react";
import { BusyMessage } from "./components/Busy";
import { RatingMethodologyDialog } from "./components/RatingMethodologyDialog";
import { useAppStore } from "./stores/appStore";
import type { Page } from "./types";

const LibraryView = lazy(() =>
  import("./features/library/LibraryView").then((m) => ({ default: m.LibraryView })),
);
const ImportView = lazy(() =>
  import("./features/import/ImportView").then((m) => ({ default: m.ImportView })),
);
const AnalysisView = lazy(() =>
  import("./features/analysis/AnalysisView").then((m) => ({ default: m.AnalysisView })),
);
const StudioView = lazy(() =>
  import("./features/studio/StudioView").then((m) => ({ default: m.StudioView })),
);
const SettingsView = lazy(() =>
  import("./features/settings/SettingsView").then((m) => ({ default: m.SettingsView })),
);

const nav: Array<{ id: Page; to: string; label: string; icon: typeof Library }> = [
  { id: "library", to: "/library", label: "资料库", icon: Library },
  { id: "import", to: "/import", label: "导入", icon: FolderInput },
  { id: "analysis", to: "/analysis", label: "比赛分析", icon: ChartNoAxesCombined },
  { id: "studio", to: "/studio/radar", label: "制作", icon: Sparkles },
  { id: "settings", to: "/settings", label: "设置", icon: Settings },
];

function isActive(id: Page, pathname: string) {
  if (id === "studio") return pathname.startsWith("/studio");
  if (id === "analysis") return pathname.startsWith("/analysis");
  return pathname === `/${id}`;
}

function HomeRedirect() {
  const players = useAppStore((state) => state.players);
  return <Navigate to={players.length ? "/library" : "/import"} replace />;
}

export default function App() {
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const bootError = useAppStore((state) => state.bootError);
  const config = useAppStore((state) => state.config);
  const players = useAppStore((state) => state.players);
  const sources = useAppStore((state) => state.sources);
  const toast = useAppStore((state) => state.toast);
  const methodologyOpen = useAppStore((state) => state.methodologyOpen);
  const setMethodologyOpen = useAppStore((state) => state.setMethodologyOpen);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (bootError && !bootstrapped)
    return (
      <div className="boot-screen">
        <img src="/logo.svg" alt="" />
        <h1>工作台无法启动</h1>
        <p>{bootError}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  if (!bootstrapped)
    return (
      <div className="boot-screen">
        <img src="/logo.svg" alt="" />
        <div className="boot-spinner" />
        <p>正在打开本地资料库…</p>
      </div>
    );

  return (
    <div className={`app-shell ${config.reduce_motion ? "reduce-motion" : ""}`}>
      <a className="skip-link" href="#main-content">
        跳到主内容
      </a>
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.svg" alt="" />
          <div>
            <strong>CS2 RADAR</strong>
            <span>CONTENT STUDIO</span>
          </div>
        </div>
        <nav aria-label="主导航">
          {nav.map(({ id, to, label, icon: Icon }) => (
            <button
              key={id}
              className={isActive(id, pathname) ? "active" : ""}
              aria-current={isActive(id, pathname) ? "page" : undefined}
              onClick={() => navigate(to)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "import" && <small>{sources.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="storage-status">
            <Database size={15} />
            <span>
              <strong>本地资料库</strong>
              <small>{players.length} 名玩家</small>
            </span>
            <i />
          </div>
          <p>离线运行 · 数据保存在本机</p>
        </div>
      </aside>
      <main id="main-content" className="app-content" tabIndex={-1}>
        <Suspense
          fallback={
            <div className="route-loading">
              <BusyMessage>正在加载页面…</BusyMessage>
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/library" element={<LibraryView />} />
            <Route path="/import" element={<ImportView followedSteamIDs={players.filter((p) => p.followed).map((p) => p.steam_id)} />} />
            <Route path="/analysis" element={<AnalysisView />} />
            <Route path="/analysis/:demoId" element={<AnalysisView />} />
            <Route path="/studio" element={<Navigate to="/studio/radar" replace />} />
            <Route path="/studio/:kind" element={<StudioView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Routes>
        </Suspense>
      </main>
      <RatingMethodologyDialog
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
      />
      {toast && (
        <div className="app-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}