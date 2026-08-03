import { useCallback, useEffect, useState } from "react";
import {
  Database,
  DownloadCloud,
  FolderInput,
  Library,
  Maximize2,
  Minimize2,
  Settings,
  Sparkles,
} from "lucide-react";
import { bridge } from "./bridge";
import { ImportView } from "./features/import/ImportView";
import { LibraryView } from "./features/library/LibraryView";
import { SettingsView } from "./features/settings/SettingsView";
import { StudioView } from "./features/studio/StudioView";
import type {
  AppConfig,
  BootstrapState,
  ImportSource,
  Page,
  SavedPlayer,
  StudioKind,
  StudioSeed,
} from "./types";
import { defaultConfig } from "./types";

export default function App() {
  const [page, setPage] = useState<Page>("library");
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [players, setPlayers] = useState<SavedPlayer[]>([]);
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [seed, setSeed] = useState<StudioSeed | null>(null);
  const [studioKind, setStudioKind] = useState<StudioKind>("radar");
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const refreshPlayers = useCallback(async () => {
    const values = await bridge.listPlayers();
    setPlayers(values);
  }, []);
  useEffect(() => {
    bridge
      .bootstrap()
      .then((value) => {
        setBootstrap(value);
        setPlayers(value.players ?? []);
        setSources(value.config.import_sources ?? []);
        setConfig(value.config);
        if (!value.players?.length) setPage("import");
      })
      .catch((value) =>
        setError(value instanceof Error ? value.message : String(value)),
      );
  }, []);
  function create(kind: StudioKind, nextSeed: StudioSeed) {
    setSeed(nextSeed);
    setStudioKind(kind);
    setPage("studio");
  }
  if (error && !bootstrap)
    return (
      <div className="boot-screen">
        <img src="/logo.svg" alt="" />
        <h1>工作台无法启动</h1>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  if (!bootstrap)
    return (
      <div className="boot-screen">
        <img src="/logo.svg" alt="" />
        <div className="boot-spinner" />
        <p>正在打开本地资料库…</p>
      </div>
    );
  const nav = [
    { id: "library" as Page, label: "资料库", icon: Library },
    { id: "import" as Page, label: "导入", icon: FolderInput },
    { id: "studio" as Page, label: "制作", icon: Sparkles },
    { id: "settings" as Page, label: "设置", icon: Settings },
  ];
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
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "import" && <small>{sources.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button
            className="fullscreen-button"
            onClick={() => bridge.toggleFullscreen().then(setFullscreen)}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {fullscreen ? "退出全屏" : "全屏工作"}
            <kbd>⌃⌘F</kbd>
          </button>
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
        {page === "library" && (
          <LibraryView
            players={players}
            refresh={refreshPlayers}
            onCreate={create}
          />
        )}{" "}
        {page === "import" && (
          <ImportView
            sources={sources}
            followedSteamIDs={players
              .filter((player) => player.followed)
              .map((player) => player.steam_id)}
            onSourcesChange={(next) => {
              setSources(next);
              setConfig({ ...config, import_sources: next });
            }}
            onImported={refreshPlayers}
          />
        )}{" "}
        {page === "studio" && (
          <StudioView
            seed={seed}
            initialKind={studioKind}
            config={config}
            onNeedMaterial={() => setPage("library")}
          />
        )}{" "}
        {page === "settings" && (
          <SettingsView
            config={config}
            onChange={setConfig}
            sources={sources}
            onSourcesChange={(next) => {
              setSources(next);
              setConfig({ ...config, import_sources: next });
            }}
            onDataChanged={refreshPlayers}
          />
        )}
      </main>
    </div>
  );
}
